-- heals-system-rebuild — write_transaction RPC
-- Migration 005: Idempotent UPSERT entry-point for the transactions table.
--
-- Scope of this file (Task 3.5):
--   * CREATE FUNCTION write_transaction(payload jsonb) — performs the
--     ON CONFLICT (branch, business_date, cashier_row_number) upsert that
--     backs every Cashier_POS write and every owner edit.
--   * Returns a one-row result set with two columns:
--       row      jsonb     — the persisted transaction serialized as JSON
--       replaced boolean   — true when an existing row was updated, false
--                            when the row was newly inserted
--   * SECURITY INVOKER: the function runs under the caller's identity so the
--     RLS policies defined in 003_rls_policies.sql apply unchanged. Cashiers
--     are still constrained to their own branch; owners retain full access;
--     the service-role client (used for EXTRA mirror writes per Req 5.2/5.3)
--     bypasses RLS by virtue of its BYPASSRLS attribute.
--
-- Why SECURITY INVOKER and not DEFINER:
--   The task description offered both options. INVOKER is the simpler choice
--   here because the surrounding RLS policies already encode the desired
--   cashier-branch scoping; switching to DEFINER would require the function
--   to re-derive role/branch and re-issue equivalent checks. INVOKER keeps a
--   single source of truth (the policies in migration 003) and matches the
--   pattern used by the salary-system-rebuild RPCs.
--
-- Detecting INSERT vs UPDATE:
--   We pre-SELECT the conflict key to capture whether a prior row exists.
--   This is more reliable than xmax-based heuristics and means the `replaced`
--   flag is true even when the new payload is byte-identical to the stored
--   row (i.e. the conflict path fired but no columns actually changed).
--
-- Preservation rules on UPDATE:
--   * created_at  — preserved (audit history must reflect the original write)
--   * created_by  — preserved (the original author's identity)
--   * updated_at  — refreshed to now()
--   * Idempotency key columns (branch, business_date, cashier_row_number) —
--     intentionally omitted from the SET list; they form the conflict target
--     so EXCLUDED.<col> equals the existing value by definition.
--
-- Optional column handling:
--   * time_in / time_out  — NULLIF('','')::time → NULL when payload omits or
--                           sends an empty string, else cast to time
--   * comment / flags     — COALESCE(... , '') → empty string default
--   * numeric amounts     — COALESCE(... , 0)  → zero default; the
--                           application layer normally supplies values
--                           computed by computeCommission()
--
-- The CHECK constraint
--   total_commission = base_commission + balm_bonus + booking_bonus + addon
-- is enforced at the table level (001_init_schema.sql); this RPC trusts the
-- caller to send consistent commission components. computeCommission() in the
-- domain layer guarantees the invariant before the payload reaches the RPC.
--
-- Requirements satisfied: 3.2, 3.3, 3.4, 3.5

CREATE OR REPLACE FUNCTION public.write_transaction(payload jsonb)
RETURNS TABLE (tx jsonb, replaced boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  prior_id uuid;
  result   public.transactions%ROWTYPE;
BEGIN
  -- Pre-flight: did a row already exist for this idempotency key?
  -- We only need the id (presence/absence is enough); selecting the whole
  -- row would be wasted I/O.
  SELECT t.id
    INTO prior_id
    FROM public.transactions t
   WHERE t.branch              = (payload ->> 'branch')
     AND t.business_date       = (payload ->> 'business_date')::date
     AND t.cashier_row_number  = (payload ->> 'cashier_row_number')::int;

  -- Idempotent upsert. The conflict target matches the unique index from
  -- 002_indexes.sql (transactions_branch_date_row_uidx), guaranteeing
  -- exactly-one-row-per-(branch,date,row_number) at the database level.
  INSERT INTO public.transactions (
    branch,
    business_date,
    cashier_row_number,
    staff,
    course,
    duration,
    time_in,
    time_out,
    method,
    addon,
    base_commission,
    balm_bonus,
    booking_bonus,
    total_commission,
    cash,
    qr,
    credit,
    price,
    flags,
    comment,
    created_at,
    updated_at,
    created_by
  )
  VALUES (
    payload ->> 'branch',
    (payload ->> 'business_date')::date,
    (payload ->> 'cashier_row_number')::int,
    payload ->> 'staff',
    payload ->> 'course',
    (payload ->> 'duration')::int,
    NULLIF(payload ->> 'time_in', '')::time,
    NULLIF(payload ->> 'time_out', '')::time,
    payload ->> 'method',
    COALESCE((payload ->> 'addon')::numeric,            0),
    COALESCE((payload ->> 'base_commission')::numeric,  0),
    COALESCE((payload ->> 'balm_bonus')::numeric,       0),
    COALESCE((payload ->> 'booking_bonus')::numeric,    0),
    COALESCE((payload ->> 'total_commission')::numeric, 0),
    COALESCE((payload ->> 'cash')::numeric,             0),
    COALESCE((payload ->> 'qr')::numeric,               0),
    COALESCE((payload ->> 'credit')::numeric,           0),
    COALESCE((payload ->> 'price')::numeric,            0),
    COALESCE(payload ->> 'flags',   ''),
    COALESCE(payload ->> 'comment', ''),
    now(),
    now(),
    auth.uid()
  )
  ON CONFLICT (branch, business_date, cashier_row_number) DO UPDATE
    SET staff            = EXCLUDED.staff,
        course           = EXCLUDED.course,
        duration         = EXCLUDED.duration,
        time_in          = EXCLUDED.time_in,
        time_out         = EXCLUDED.time_out,
        method           = EXCLUDED.method,
        addon            = EXCLUDED.addon,
        base_commission  = EXCLUDED.base_commission,
        balm_bonus       = EXCLUDED.balm_bonus,
        booking_bonus    = EXCLUDED.booking_bonus,
        total_commission = EXCLUDED.total_commission,
        cash             = EXCLUDED.cash,
        qr               = EXCLUDED.qr,
        credit           = EXCLUDED.credit,
        price            = EXCLUDED.price,
        flags            = EXCLUDED.flags,
        comment          = EXCLUDED.comment,
        updated_at       = now()
        -- created_at and created_by are deliberately NOT in the SET list:
        -- last-write-wins replaces values but never rewrites authorship.
  RETURNING *
       INTO result;

  RETURN QUERY
  SELECT to_jsonb(result), prior_id IS NOT NULL;
END;
$$;

-- Grant execute to authenticated callers; the service role inherits all
-- privileges and additionally bypasses RLS, so no separate grant is needed.
GRANT EXECUTE ON FUNCTION public.write_transaction(jsonb) TO authenticated;
