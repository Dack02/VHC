-- Estimates: explicit "customer finished responding" marker.
--
-- The public estimate portal lets a customer approve/decline individual lines. We need to
-- distinguish "customer is mid-review" from "customer has confirmed their final response":
--   * responded_at          = time of the customer's FIRST line decision (may still be editing)
--   * response_finalised_at = set only when the customer explicitly confirms via
--                             "Submit my response" / "Approve all" / "Decline all"
--
-- The portal stays interactive (lines can be toggled) until response_finalised_at is set;
-- once set, the portal locks and shows the thank-you confirmation. Additive + idempotent.

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS response_finalised_at TIMESTAMPTZ;

COMMENT ON COLUMN estimates.response_finalised_at IS
  'When the customer explicitly submitted their final estimate response (Submit / Approve all / Decline all). Distinct from responded_at (first line decision). Drives the public portal lock.';
