-- =============================================================================
-- Parts module — atomic journal writer (GMS/PARTS.md §5.10 invariants)
-- =============================================================================
-- One function = one transaction: insert a balanced header + lines atomically,
-- enforce SUM(debit)=SUM(credit), and dedup on (organization_id, idempotency_key).
-- Returns the journal id (existing one if the idempotency key was already used).
-- period_key / totals are computed by the caller (period-lock aware) and passed in.
-- =============================================================================

CREATE OR REPLACE FUNCTION post_inventory_journal(p_header jsonb, p_lines jsonb)
RETURNS uuid AS $$
DECLARE
  v_journal_id uuid;
  v_org uuid := (p_header->>'organization_id')::uuid;
  v_key text := p_header->>'idempotency_key';
  v_debit numeric;
  v_credit numeric;
  v_line jsonb;
BEGIN
  -- Idempotency: if this key already posted, return the existing journal.
  SELECT id INTO v_journal_id FROM inventory_journal
    WHERE organization_id = v_org AND idempotency_key = v_key;
  IF v_journal_id IS NOT NULL THEN
    RETURN v_journal_id;
  END IF;

  -- Balance check (ΣDr = ΣCr to the penny).
  SELECT COALESCE(sum((l->>'debit')::numeric), 0), COALESCE(sum((l->>'credit')::numeric), 0)
    INTO v_debit, v_credit
    FROM jsonb_array_elements(p_lines) l;
  IF round(v_debit, 2) <> round(v_credit, 2) THEN
    RAISE EXCEPTION 'Unbalanced inventory journal (%): debit % <> credit %', v_key, v_debit, v_credit;
  END IF;
  IF jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'Inventory journal % needs >= 2 lines', v_key;
  END IF;

  INSERT INTO inventory_journal (
    organization_id, source_event, source_type, source_id, jobsheet_id, health_check_id,
    document_date, period_key, invoice_number, tax_point_date,
    net_total, tax_total, gross_total, idempotency_key, posting_status, reversal_of, currency, created_by
  ) VALUES (
    v_org,
    p_header->>'source_event',
    NULLIF(p_header->>'source_type', ''),
    NULLIF(p_header->>'source_id', '')::uuid,
    NULLIF(p_header->>'jobsheet_id', '')::uuid,
    NULLIF(p_header->>'health_check_id', '')::uuid,
    (p_header->>'document_date')::date,
    p_header->>'period_key',
    NULLIF(p_header->>'invoice_number', ''),
    NULLIF(p_header->>'tax_point_date', '')::date,
    COALESCE((p_header->>'net_total')::numeric, 0),
    COALESCE((p_header->>'tax_total')::numeric, 0),
    COALESCE((p_header->>'gross_total')::numeric, 0),
    v_key,
    COALESCE(NULLIF(p_header->>'posting_status', ''), 'posted'),
    NULLIF(p_header->>'reversal_of', '')::uuid,
    COALESCE(NULLIF(p_header->>'currency', ''), 'GBP'),
    NULLIF(p_header->>'created_by', '')::uuid
  ) RETURNING id INTO v_journal_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO inventory_journal_lines (
      journal_id, organization_id, internal_account_key, debit, credit,
      tax_code, tax_amount, tracking_site_id, tracking_job_id, entity_type, entity_id,
      line_description, sort_order
    ) VALUES (
      v_journal_id, v_org,
      v_line->>'account',
      COALESCE((v_line->>'debit')::numeric, 0),
      COALESCE((v_line->>'credit')::numeric, 0),
      NULLIF(v_line->>'tax_code', ''),
      COALESCE((v_line->>'tax_amount')::numeric, 0),
      NULLIF(v_line->>'tracking_site_id', '')::uuid,
      NULLIF(v_line->>'tracking_job_id', '')::uuid,
      NULLIF(v_line->>'entity_type', ''),
      NULLIF(v_line->>'entity_id', '')::uuid,
      NULLIF(v_line->>'description', ''),
      COALESCE((v_line->>'sort_order')::int, 0)
    );
  END LOOP;

  RETURN v_journal_id;

EXCEPTION WHEN unique_violation THEN
  -- Concurrent post with the same idempotency key: return the winner.
  SELECT id INTO v_journal_id FROM inventory_journal
    WHERE organization_id = v_org AND idempotency_key = v_key;
  RETURN v_journal_id;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION post_inventory_journal(jsonb, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION post_inventory_journal(jsonb, jsonb) TO service_role;
