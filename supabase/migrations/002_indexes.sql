-- heals-system-rebuild — indexes and unique constraints
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
--   * 3.5  — unique (branch, business_date, cashier_row_number) for dedupe.
--   * 20.2 — unique constraint on transactions identity.
--   * 20.3 — expenses lookup support.
--   * 20.4 — case-insensitive uniqueness on staff.name.
--   * 20.5 — versioned uniqueness for commission_rates and prices.

-- =============================================================================
-- transactions — idempotent write key + board query index
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
-- staff — case-insensitive unique name (Req 20.4)
-- =============================================================================

-- Functional index on lower(trim(name)) so the seed script can ON CONFLICT
-- against the normalized name (Task 3.8) and so freeform/manual entries can't
-- create casing-only duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS staff_name_normalized_uidx
  ON staff (lower(trim(name)));

-- =============================================================================
-- daily_roster — one row per (branch, day, staff)
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS daily_roster_branch_date_staff_uidx
  ON daily_roster (branch, business_date, staff_id);

-- =============================================================================
-- commission_rates — versioned uniqueness (Req 20.5)
-- =============================================================================

-- Ensures only one rate row per (course, duration, rate_type, branch_group,
-- effective_from); rate updates create a new row rather than mutating history.
CREATE UNIQUE INDEX IF NOT EXISTS commission_rates_lookup_uidx
  ON commission_rates (course, duration, rate_type, branch_group, effective_from);

-- =============================================================================
-- prices — one customer price per (course, duration, branch)
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS prices_course_duration_branch_uidx
  ON prices (course, duration, branch);

-- =============================================================================
-- expenses — board / report lookup
-- =============================================================================

CREATE INDEX IF NOT EXISTS expenses_business_date_branch_idx
  ON expenses (business_date, branch);

-- =============================================================================
-- audit_log — owner-facing audit queries (Req 1.6)
-- =============================================================================

CREATE INDEX IF NOT EXISTS audit_log_actor_created_idx
  ON audit_log (actor_id, created_at);
