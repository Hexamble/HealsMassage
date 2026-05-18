/**
 * Daily snapshot aggregation — pure-TypeScript mirror of the SQL
 * `take_daily_snapshot(p_date)` function in migration
 * `20260104000400_daily_snapshots.sql`.
 *
 * Why this exists. The SQL function is the system of record at write
 * time, but we want the same arithmetic available in a pure function
 * for two reasons:
 *
 *   1. Property tests. Property 27 (idempotency) and property 28
 *      (consistency) are easier and faster to drive against an
 *      in-process function than against a real Postgres round-trip.
 *      The properties are universal — they should hold for any input
 *      set — and a pure helper lets fast-check generate hundreds of
 *      cases per second.
 *   2. Past-day rendering. Owner pages that read past-day data
 *      compare a stored snapshot row against the live transactions
 *      to decide whether to show "edited since snapshot" warnings.
 *      The pages need a way to recompute totals locally to detect
 *      drift; reusing this helper keeps the maths in lockstep with
 *      the SQL.
 *
 * Aggregation rules (match the SQL function exactly):
 *   - sales      = Σ price       over real (non-EXTRA) rows
 *   - cash/qr/credit             same row set, per-method totals
 *   - sessions   = count(*)      over the same row set
 *   - commission = Σ commission  over ALL rows (incl. EXTRA — the
 *                  canonical view counts EXTRA fallbacks toward the
 *                  destination staff's total)
 *   - expenses   = Σ amount      from `expenses` for (date, branch)
 *   - net        = sales − expenses
 *
 * Numeric coercion. `numeric(10,2)` columns can arrive as strings via
 * supabase-js. {@link num} defends against that and against any other
 * stray non-numeric input by treating NaN/null/undefined as 0 — the
 * snapshot is a trailing summary, not a place to surface input bugs.
 *
 * Validates: tasks.md 21.7. Properties 27 (idempotency) and 28
 * (consistency) are tested in `daily-snapshots.test.ts`.
 */

import { isExtraMethod } from './extra'
import type { Branch } from './row-id'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Subset of a transaction row consumed by the aggregator. Field names
 * are camelCase to match the rest of the domain layer; raw DB rows
 * are mapped at the action / page boundary.
 */
export interface SnapshotTransactionRow {
  branch: Branch
  businessDate: string
  method: string
  price: number | string | null | undefined
  cash: number | string | null | undefined
  qr: number | string | null | undefined
  credit: number | string | null | undefined
  commission: number | string | null | undefined
}

export interface SnapshotExpenseRow {
  branch: Branch
  businessDate: string
  amount: number | string | null | undefined
}

export interface DailySnapshotRow {
  branch: Branch
  sales: number
  cash: number
  qr: number
  credit: number
  sessions: number
  commission: number
  expenses: number
  net: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// ---------------------------------------------------------------------------
// aggregateDay
// ---------------------------------------------------------------------------

/**
 * Compute the snapshot row for a single (date, branch). Pure: no I/O.
 *
 * `rows` and `expenses` may include data for any date / branch; the
 * function filters internally so callers can pass an unfiltered slice
 * without pre-grouping.
 *
 * @param rows      — every transaction in the day's input set. The
 *                    function picks rows where `branch === branch` AND
 *                    `businessDate === businessDate`.
 * @param expenses  — every expense in the day's input set; same filter.
 * @param branch    — the branch this snapshot is for.
 * @param businessDate — the business date this snapshot is for.
 */
export function aggregateDay(
  rows: ReadonlyArray<SnapshotTransactionRow>,
  expenses: ReadonlyArray<SnapshotExpenseRow>,
  branch: Branch,
  businessDate: string,
): DailySnapshotRow {
  let sales = 0
  let cash = 0
  let qr = 0
  let credit = 0
  let sessions = 0
  let commission = 0
  let expenseTotal = 0

  for (const row of rows) {
    if (row.branch !== branch) continue
    if (row.businessDate !== businessDate) continue

    // Commission is summed over ALL rows (incl. EXTRA) — the canonical
    // view counts EXTRA fallbacks toward the destination staff.
    commission += num(row.commission)

    if (isExtraMethod(String(row.method ?? ''))) continue

    sales += num(row.price)
    cash += num(row.cash)
    qr += num(row.qr)
    credit += num(row.credit)
    sessions += 1
  }

  for (const exp of expenses) {
    if (exp.branch !== branch) continue
    if (exp.businessDate !== businessDate) continue
    expenseTotal += num(exp.amount)
  }

  return {
    branch,
    sales,
    cash,
    qr,
    credit,
    sessions,
    commission,
    expenses: expenseTotal,
    net: sales - expenseTotal,
  }
}
