-- heals-system-rebuild — audit trigger
-- Migration 004: AFTER INSERT/UPDATE/DELETE triggers that append to audit_log.
--
-- Scope of this file (Task 3.4):
--   * CREATE FUNCTION audit_log_write() — generic trigger function that inserts
--     one audit_log row per write operation, capturing
--       - table_name : the source table (TG_TABLE_NAME)
--       - op         : 'INSERT' | 'UPDATE' | 'DELETE' (TG_OP, matches CHECK)
--       - row_pk     : text-cast primary key (column name passed via TG_ARGV[0])
--       - actor_id   : auth.uid() (NULL for service-role / system writes)
--       - payload    : row_to_json(NEW) for INSERT/UPDATE, row_to_json(OLD)
--                      for DELETE (COALESCE keeps NULLs from breaking the cast)
--       - created_at : default now()
--   * CREATE TRIGGER bindings on every write-tracked user table:
--       transactions, expenses, daily_roster, staff,
--       commission_rates, prices, settings.
--
-- Out of scope:
--   * audit_log itself MUST NOT carry a trigger (would self-reference and would
--     also flip Req 1.6's "writes only" rule into infinite recursion).
--   * Read operations are never logged (Req 1.6: only writes).
--   * RLS for audit_log is set in 003_rls_policies.sql; this trigger writes
--     under SECURITY DEFINER so it bypasses RLS regardless of caller role.
--
-- Requirements satisfied: 1.6
--
-- PK extraction strategy:
--   The seven tracked tables use two different primary-key shapes:
--     - id uuid    : transactions, expenses, daily_roster, staff,
--                    commission_rates, prices
--     - key text   : settings
--   Rather than branching with TG_TABLE_NAME, the PK column name is passed as
--   the first trigger argument (TG_ARGV[0]) and extracted from row_to_json,
--   which works uniformly for any column type and renders as text via ->>.

-- =============================================================================
-- Trigger function
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_log_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pk_column text := TG_ARGV[0];
  row_payload jsonb;
  pk_value text;
BEGIN
  -- For DELETE there is no NEW; for INSERT there is no OLD. COALESCE picks
  -- whichever side is populated so the same expression works for all three ops.
  row_payload := to_jsonb(COALESCE(NEW, OLD));
  pk_value := row_payload ->> pk_column;

  INSERT INTO audit_log (table_name, op, row_pk, actor_id, payload, created_at)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    pk_value,
    auth.uid(),
    row_payload,
    now()
  );

  -- AFTER triggers ignore the return value, but PL/pgSQL still requires one.
  -- Returning NULL is the conventional choice for AFTER triggers.
  RETURN NULL;
END;
$$;

-- =============================================================================
-- Trigger bindings
--   One AFTER INSERT OR UPDATE OR DELETE trigger per tracked table.
--   Pass the primary-key column name as TG_ARGV[0].
-- =============================================================================

CREATE TRIGGER audit_transactions
  AFTER INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION audit_log_write('id');

CREATE TRIGGER audit_expenses
  AFTER INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION audit_log_write('id');

CREATE TRIGGER audit_daily_roster
  AFTER INSERT OR UPDATE OR DELETE ON daily_roster
  FOR EACH ROW EXECUTE FUNCTION audit_log_write('id');

CREATE TRIGGER audit_staff
  AFTER INSERT OR UPDATE OR DELETE ON staff
  FOR EACH ROW EXECUTE FUNCTION audit_log_write('id');

CREATE TRIGGER audit_commission_rates
  AFTER INSERT OR UPDATE OR DELETE ON commission_rates
  FOR EACH ROW EXECUTE FUNCTION audit_log_write('id');

CREATE TRIGGER audit_prices
  AFTER INSERT OR UPDATE OR DELETE ON prices
  FOR EACH ROW EXECUTE FUNCTION audit_log_write('id');

CREATE TRIGGER audit_settings
  AFTER INSERT OR UPDATE OR DELETE ON settings
  FOR EACH ROW EXECUTE FUNCTION audit_log_write('key');

-- audit_log intentionally has NO trigger:
--   * Req 1.6 logs writes; logging the log would recurse and double-count.
--   * Inserts into audit_log come exclusively from this trigger function
--     (or from the service role for system-level events).
