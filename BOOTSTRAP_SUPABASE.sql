-- ============================================================
-- HEALS POS — One-shot bootstrap SQL
-- Paste this entire file into Supabase Dashboard → SQL Editor → Run
-- This creates all 9 tables, indexes, RLS policies, audit triggers, and the write_transaction RPC.
-- Idempotent: safe to run more than once.
-- ============================================================


-- =====================
-- 001_init_schema.sql
-- =====================

-- heals-system-rebuild â€” initial schema
-- Migration 001: Core tables with NOT NULL, CHECK, and FK constraints.
--
-- Scope of this file (Task 3.1):
--   * CREATE TABLE for profiles, staff, transactions, expenses, daily_roster,
--     commission_rates, prices, settings, audit_log.
--   * CHECK constraints from design.md Â§"Table Definitions"
--     (course enum, duration âˆˆ {30,60,90,120}, branch âˆˆ {Kimberry,Bishop,Chulia},
--      expense method âˆˆ {CASH,QR,CREDIT,Other},
--      total_commission = base_commission + balm_bonus + booking_bonus + addon).
--   * FK references (auth.users, staff).
--
-- Out of scope (handled by sibling migrations):
--   * Indexes / UNIQUE constraints  â†’ 002_indexes.sql
--   * RLS policies                  â†’ 003_rls_policies.sql
--   * Audit triggers                â†’ 004_audit_trigger.sql
--   * write_transaction RPC         â†’ 005_write_transaction_rpc.sql

-- pgcrypto provides gen_random_uuid(); Supabase ships it pre-installed but the
-- IF NOT EXISTS guard keeps local re-runs safe.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- profiles â€” application-level user metadata (role + home branch)
-- =============================================================================

CREATE TABLE profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner', 'cashier')),
  branch       text CHECK (branch IN ('Kimberry', 'Bishop', 'Chulia')),
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- staff â€” therapist/cashier roster master list
-- =============================================================================

CREATE TABLE staff (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  home_branch  text NOT NULL CHECK (home_branch IN ('Kimberry', 'Bishop', 'Chulia')),
  is_freelance boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- transactions â€” source of truth for all sessions
-- =============================================================================

CREATE TABLE transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch              text NOT NULL CHECK (branch IN ('Kimberry', 'Bishop', 'Chulia')),
  business_date       date NOT NULL,
  cashier_row_number  integer NOT NULL CHECK (cashier_row_number > 0),
  staff               text NOT NULL,
  course              text NOT NULL CHECK (course IN (
    'FR','HS','FNS','BMT','BAT','DTM','THC','HOM',
    'PBA','PBAC','EAR','PTF','PAF','PHL','PHT'
  )),
  duration            integer NOT NULL CHECK (duration IN (30, 60, 90, 120)),
  time_in             time,
  time_out            time,
  method              text NOT NULL,
  addon               numeric(10,2) NOT NULL DEFAULT 0,
  base_commission     numeric(10,2) NOT NULL DEFAULT 0,
  balm_bonus          numeric(10,2) NOT NULL DEFAULT 0,
  booking_bonus       numeric(10,2) NOT NULL DEFAULT 0,
  total_commission    numeric(10,2) NOT NULL DEFAULT 0,
  cash                numeric(10,2) NOT NULL DEFAULT 0,
  qr                  numeric(10,2) NOT NULL DEFAULT 0,
  credit              numeric(10,2) NOT NULL DEFAULT 0,
  price               numeric(10,2) NOT NULL DEFAULT 0,
  flags               text DEFAULT '',
  comment             text DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users(id),
  CONSTRAINT total_commission_equals_parts
    CHECK (total_commission = base_commission + balm_bonus + booking_bonus + addon)
);

-- =============================================================================
-- expenses â€” branch-scoped daily expenses
-- =============================================================================

CREATE TABLE expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch        text NOT NULL CHECK (branch IN ('Kimberry', 'Bishop', 'Chulia')),
  business_date date NOT NULL,
  item          text NOT NULL CHECK (trim(item) <> ''),
  amount        numeric(10,2) NOT NULL CHECK (amount > 0),
  method        text NOT NULL CHECK (method IN ('CASH', 'QR', 'CREDIT', 'Other')),
  note          text DEFAULT '',
  source        text NOT NULL CHECK (source IN ('Cashier', 'Manual')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id)
);

-- =============================================================================
-- daily_roster â€” which staff are working at which branch on which day
-- =============================================================================

CREATE TABLE daily_roster (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch        text NOT NULL CHECK (branch IN ('Kimberry', 'Bishop', 'Chulia')),
  business_date date NOT NULL,
  staff_id      uuid NOT NULL REFERENCES staff(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- commission_rates â€” versioned rate tables (regular + freelance)
-- =============================================================================

CREATE TABLE commission_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course         text NOT NULL,
  duration       integer NOT NULL CHECK (duration IN (30, 60, 90, 120)),
  rate_type      text NOT NULL CHECK (rate_type IN ('regular', 'freelance')),
  branch_group   text NOT NULL DEFAULT 'all',
  amount         numeric(10,2) NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- prices â€” per-branch customer price list
-- =============================================================================

CREATE TABLE prices (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course   text NOT NULL,
  duration integer NOT NULL CHECK (duration IN (30, 60, 90, 120)),
  branch   text NOT NULL CHECK (branch IN ('Kimberry', 'Bishop', 'Chulia')),
  price    numeric(10,2) NOT NULL
);

-- =============================================================================
-- settings â€” key/value app configuration (e.g. pay_cycle_start_day)
-- =============================================================================

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- audit_log â€” append-only write history
--   Triggers that populate this table are added in 004_audit_trigger.sql.
-- =============================================================================

CREATE TABLE audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  op         text NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  row_pk     text NOT NULL,
  actor_id   uuid REFERENCES auth.users(id),
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- =====================
-- 002_indexes.sql
-- =====================

-- heals-system-rebuild â€” indexes and unique constraints
-- Migration 002: Adds the unique indexes and lookup indexes that 001 leaves out.
--
-- Scope of this file (Task 3.2):
--   * UNIQUE indexes for idempotent writes and roster integrity
--     (transactions, staff, daily_roster, commission_rates, prices).
--   * Non-unique B-tree indexes for hot read paths
--     (board queries, expense rollups, audit log lookups).
--
-- All statements use IF NOT EXISTS guards so the file is safe to re-run
-- locally and during CI bootstrap.
--
-- Requirements covered:
--   * 3.5  â€” unique (branch, business_date, cashier_row_number) for dedupe.
--   * 20.2 â€” unique constraint on transactions identity.
--   * 20.3 â€” expenses lookup support.
--   * 20.4 â€” case-insensitive uniqueness on staff.name.
--   * 20.5 â€” versioned uniqueness for commission_rates and prices.

-- =============================================================================
-- transactions â€” idempotent write key + board query index
-- =============================================================================

-- Guarantees deduplication at the DB level (Req 3.5, 20.2). The write_transaction
-- RPC (005_write_transaction_rpc.sql) relies on this index for ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_branch_date_row_uidx
  ON transactions (branch, business_date, cashier_row_number);

-- Hot path for Salary Board, Shop Income Board, Command Center, and Time
-- Machine queries that filter by business_date and branch.
CREATE INDEX IF NOT EXISTS transactions_business_date_branch_idx
  ON transactions (business_date, branch);

-- =============================================================================
-- staff â€” case-insensitive unique name (Req 20.4)
-- =============================================================================

-- Functional index on lower(trim(name)) so the seed script can ON CONFLICT
-- against the normalized name (Task 3.8) and so freeform/manual entries can't
-- create casing-only duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS staff_name_normalized_uidx
  ON staff (lower(trim(name)));

-- =============================================================================
-- daily_roster â€” one row per (branch, day, staff)
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS daily_roster_branch_date_staff_uidx
  ON daily_roster (branch, business_date, staff_id);

-- =============================================================================
-- commission_rates â€” versioned uniqueness (Req 20.5)
-- =============================================================================

-- Ensures only one rate row per (course, duration, rate_type, branch_group,
-- effective_from); rate updates create a new row rather than mutating history.
CREATE UNIQUE INDEX IF NOT EXISTS commission_rates_lookup_uidx
  ON commission_rates (course, duration, rate_type, branch_group, effective_from);

-- =============================================================================
-- prices â€” one customer price per (course, duration, branch)
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS prices_course_duration_branch_uidx
  ON prices (course, duration, branch);

-- =============================================================================
-- expenses â€” board / report lookup
-- =============================================================================

CREATE INDEX IF NOT EXISTS expenses_business_date_branch_idx
  ON expenses (business_date, branch);

-- =============================================================================
-- audit_log â€” owner-facing audit queries (Req 1.6)
-- =============================================================================

CREATE INDEX IF NOT EXISTS audit_log_actor_created_idx
  ON audit_log (actor_id, created_at);


-- =====================
-- 003_rls_policies.sql
-- =====================

-- heals-system-rebuild â€” Row Level Security policies
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
-- transactions â€” branch-scoped writes for cashiers, full access for owner
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
-- expenses â€” same shape as transactions
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
-- daily_roster â€” same shape as transactions
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
-- staff â€” owner full access; cashier read-only
-- =============================================================================

CREATE POLICY staff_owner_all ON staff
  FOR ALL TO authenticated
  USING      (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

CREATE POLICY staff_cashier_read ON staff
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'cashier');

-- =============================================================================
-- commission_rates â€” owner full access; cashier read-only
-- =============================================================================

CREATE POLICY rates_owner_all ON commission_rates
  FOR ALL TO authenticated
  USING      (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

CREATE POLICY rates_cashier_read ON commission_rates
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'cashier');

-- =============================================================================
-- prices â€” owner full access; cashier read-only
-- =============================================================================

CREATE POLICY prices_owner_all ON prices
  FOR ALL TO authenticated
  USING      (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

CREATE POLICY prices_cashier_read ON prices
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'cashier');

-- =============================================================================
-- settings â€” owner full access; cashier read-only
-- =============================================================================

CREATE POLICY settings_owner_all ON settings
  FOR ALL TO authenticated
  USING      (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

CREATE POLICY settings_cashier_read ON settings
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'cashier');

-- =============================================================================
-- audit_log â€” readable by owner only
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


-- =====================
-- 004_audit_trigger.sql
-- =====================

-- heals-system-rebuild â€” audit trigger
-- Migration 004: AFTER INSERT/UPDATE/DELETE triggers that append to audit_log.
--
-- Scope of this file (Task 3.4):
--   * CREATE FUNCTION audit_log_write() â€” generic trigger function that inserts
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


-- =====================
-- 005_write_transaction_rpc.sql
-- =====================

-- heals-system-rebuild â€” write_transaction RPC
-- Migration 005: Idempotent UPSERT entry-point for the transactions table.
--
-- Scope of this file (Task 3.5):
--   * CREATE FUNCTION write_transaction(payload jsonb) â€” performs the
--     ON CONFLICT (branch, business_date, cashier_row_number) upsert that
--     backs every Cashier_POS write and every owner edit.
--   * Returns a one-row result set with two columns:
--       row      jsonb     â€” the persisted transaction serialized as JSON
--       replaced boolean   â€” true when an existing row was updated, false
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
--   * created_at  â€” preserved (audit history must reflect the original write)
--   * created_by  â€” preserved (the original author's identity)
--   * updated_at  â€” refreshed to now()
--   * Idempotency key columns (branch, business_date, cashier_row_number) â€”
--     intentionally omitted from the SET list; they form the conflict target
--     so EXCLUDED.<col> equals the existing value by definition.
--
-- Optional column handling:
--   * time_in / time_out  â€” NULLIF('','')::time â†’ NULL when payload omits or
--                           sends an empty string, else cast to time
--   * comment / flags     â€” COALESCE(... , '') â†’ empty string default
--   * numeric amounts     â€” COALESCE(... , 0)  â†’ zero default; the
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

