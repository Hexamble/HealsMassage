-- heals-system-rebuild — Row Level Security policies
-- Migration 003: Enable RLS and define per-role policies for all user tables.
--
-- Scope of this file (Task 3.3):
--   * Enable RLS on transactions, expenses, daily_roster, staff,
--     commission_rates, prices, settings, audit_log.
--   * Owner: full read+write on every table (FOR ALL with USING + WITH CHECK).
--   * Cashier: branch-scoped read+write on transactions, expenses, daily_roster
--     (filtered by profiles.branch); read-only on staff, commission_rates,
--     prices, settings.
--   * audit_log: readable by owner only; INSERTs are performed exclusively via
--     the service role (which bypasses RLS), so no public write policies.
--
-- Out of scope:
--   * Schema (001_init_schema.sql)
--   * Indexes (002_indexes.sql)
--   * Audit triggers (004_audit_trigger.sql)
--   * write_transaction RPC (005_write_transaction_rpc.sql)
--
-- Authorization model:
--   The application identity is keyed by auth.uid() and resolved against the
--   public.profiles table to fetch role ('owner'|'cashier') and home branch.
--   We expose two SECURITY DEFINER helper functions, current_user_role() and
--   current_user_branch(), so policies can reference role/branch without
--   inlining a subquery on every row evaluation. SECURITY DEFINER also lets
--   these helpers read profiles regardless of any RLS that may be enabled on
--   profiles in the future.
--
-- Service role:
--   The service role bypasses RLS entirely (Postgres `BYPASSRLS` granted by
--   Supabase). Server actions that need to write audit_log or perform mirror
--   writes use the service-role client.

-- =============================================================================
-- Helper functions: cache role/branch lookup against profiles
-- =============================================================================

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_branch()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT branch FROM public.profiles WHERE user_id = auth.uid()
$$;

-- Allow authenticated callers to invoke the helpers from within policies.
GRANT EXECUTE ON FUNCTION public.current_user_role()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_branch() TO authenticated;

-- =============================================================================
-- Enable RLS on every user table in scope
-- =============================================================================

ALTER TABLE transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_roster      ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff             ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- transactions — branch-scoped writes for cashiers, full access for owner
-- =============================================================================

CREATE POLICY tx_owner_all ON transactions
  FOR ALL TO authenticated
  USING      (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

CREATE POLICY tx_cashier_branch_all ON transactions
  FOR ALL TO authenticated
  USING (
    public.current_user_role()   = 'cashier'
    AND public.current_user_branch() = transactions.branch
  )
  WITH CHECK (
    public.current_user_role()   = 'cashier'
    AND public.current_user_branch() = transactions.branch
  );

-- =============================================================================
-- expenses — same shape as transactions
-- =============================================================================

CREATE POLICY exp_owner_all ON expenses
  FOR ALL TO authenticated
  USING      (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

CREATE POLICY exp_cashier_branch_all ON expenses
  FOR ALL TO authenticated
  USING (
    public.current_user_role()   = 'cashier'
    AND public.current_user_branch() = expenses.branch
  )
  WITH CHECK (
    public.current_user_role()   = 'cashier'
    AND public.current_user_branch() = expenses.branch
  );

-- =============================================================================
-- daily_roster — same shape as transactions
-- =============================================================================

CREATE POLICY roster_owner_all ON daily_roster
  FOR ALL TO authenticated
  USING      (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

CREATE POLICY roster_cashier_branch_all ON daily_roster
  FOR ALL TO authenticated
  USING (
    public.current_user_role()   = 'cashier'
    AND public.current_user_branch() = daily_roster.branch
  )
  WITH CHECK (
    public.current_user_role()   = 'cashier'
    AND public.current_user_branch() = daily_roster.branch
  );

-- =============================================================================
-- staff — owner full access; cashier read-only
-- =============================================================================

CREATE POLICY staff_owner_all ON staff
  FOR ALL TO authenticated
  USING      (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

CREATE POLICY staff_cashier_read ON staff
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'cashier');

-- =============================================================================
-- commission_rates — owner full access; cashier read-only
-- =============================================================================

CREATE POLICY rates_owner_all ON commission_rates
  FOR ALL TO authenticated
  USING      (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

CREATE POLICY rates_cashier_read ON commission_rates
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'cashier');

-- =============================================================================
-- prices — owner full access; cashier read-only
-- =============================================================================

CREATE POLICY prices_owner_all ON prices
  FOR ALL TO authenticated
  USING      (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

CREATE POLICY prices_cashier_read ON prices
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'cashier');

-- =============================================================================
-- settings — owner full access; cashier read-only
-- =============================================================================

CREATE POLICY settings_owner_all ON settings
  FOR ALL TO authenticated
  USING      (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

CREATE POLICY settings_cashier_read ON settings
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'cashier');

-- =============================================================================
-- audit_log — readable by owner only
--   No INSERT/UPDATE/DELETE policies are defined for the authenticated role.
--   Audit trigger functions run with the privileges of the originating session
--   user (the audit trigger in 004_audit_trigger.sql is declared SECURITY
--   DEFINER so it can write rows regardless of the caller's RLS); ad-hoc audit
--   inserts from server actions go through the service-role client, which
--   bypasses RLS by virtue of the BYPASSRLS attribute granted by Supabase.
-- =============================================================================

CREATE POLICY audit_owner_read ON audit_log
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'owner');
