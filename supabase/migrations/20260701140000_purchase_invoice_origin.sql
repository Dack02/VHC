-- Purchase Invoice entry (invoice-in-hand) — GMS/PARTS.md.
--
-- A "direct invoice" is recorded as a purchase_order created straight to
-- status='invoiced', reusing the existing PO + goods-receipt + Event-2 journal rails
-- (no new accounting tables: an invoice is a PO + its inventory_journal). These additive
-- columns let the purchase-ledger view label invoices, keep auto-created invoice-POs out
-- of the open-orders list, and make the direct-invoice POST idempotent.
--
-- Additive only (IF NOT EXISTS) — safe to re-run, never modifies applied migrations.

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS origin VARCHAR(16) NOT NULL DEFAULT 'order';

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS supplier_invoice_date DATE;

-- Idempotency key for the invoice-in-hand POST: a double-submit / lost-response retry must
-- not mint a second PO (which would duplicate stock receipts, journals and job parts). The
-- client sends a stable UUID; the server short-circuits to the existing invoice on a repeat.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_po_client_request_per_org
  ON purchase_orders (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN purchase_orders.origin IS
  'order | direct_invoice — provenance of the PO. direct_invoice = entered invoice-in-hand (straight to status=invoiced).';
COMMENT ON COLUMN purchase_orders.supplier_invoice_date IS
  'Supplier invoice (tax-point) date captured at supplier-invoice / direct-invoice entry; null until invoiced.';
COMMENT ON COLUMN purchase_orders.client_request_id IS
  'Idempotency key for the invoice-in-hand POST — unique per org when set; a repeat returns the existing invoice.';
