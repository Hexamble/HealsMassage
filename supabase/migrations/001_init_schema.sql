-- heals-system-rebuild — initial schema
-- Migration 001: Core tables with NOT NULL, CHECK, and FK constraints.
--
-- Scope of this file (Task 3.1):
--   * CREATE TABLE for profiles, staff, transactions, expenses, daily_roster,
--     commission_rates, prices, settings, audit_log.
--   * CHECK constraints from design.md §"Table Definitions"
--     (course enum, duration ∈ {30,60,90,120}, branch ∈ {Kimberry,Bishop,Chulia},
--      expense method ∈ {CASH,QR,CREDIT,Other},
--      total_commission = base_commission + balm_bonus + booking_bonus + addon).
--   * FK references (auth.users, staff).
--
-- Out of scope (handled by sibling migrations):
--   * Indexes / UNIQUE constraints  → 002_indexes.sql
--   * RLS policies                  → 003_rls_policies.sql
--   * Audit triggers                → 004_audit_trigger.sql
--   * write_transaction RPC         → 005_write_transaction_rpc.sql

-- pgcrypto provides gen_random_uuid(); Supabase ships it pre-installed but the
-- IF NOT EXISTS guard keeps local re-runs safe.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- profiles — application-level user metadata (role + home branch)
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
-- staff — therapist/cashier roster master list
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
-- transactions — source of truth for all sessions
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
-- expenses — branch-scoped daily expenses
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
-- daily_roster — which staff are working at which branch on which day
-- =============================================================================

CREATE TABLE daily_roster (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch        text NOT NULL CHECK (branch IN ('Kimberry', 'Bishop', 'Chulia')),
  business_date date NOT NULL,
  staff_id      uuid NOT NULL REFERENCES staff(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- commission_rates — versioned rate tables (regular + freelance)
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
-- prices — per-branch customer price list
-- =============================================================================

CREATE TABLE prices (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course   text NOT NULL,
  duration integer NOT NULL CHECK (duration IN (30, 60, 90, 120)),
  branch   text NOT NULL CHECK (branch IN ('Kimberry', 'Bishop', 'Chulia')),
  price    numeric(10,2) NOT NULL
);

-- =============================================================================
-- settings — key/value app configuration (e.g. pay_cycle_start_day)
-- =============================================================================

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- audit_log — append-only write history
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
