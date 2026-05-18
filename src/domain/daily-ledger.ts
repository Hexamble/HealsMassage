/**
 * Daily ledger view — per (business_date × branch) financial roll-up.
 *
 * Mirrors the legacy boss-HQ sheet's daily summary. For each
 * (date, branch) cell, sums:
 *
 *   - `sales`         = Σ price          over real (non-EXTRA) transactions
 *   - `cash` / `qr` / `credit`           per-method totals on those same rows
 *   - `freelancePaid` = Σ freelancer_payout over Freelance transactions
 *   - `expense`       = Σ amount         over expenses
 *   - `net`           = sales − freelancePaid − expense
 *
 * Why exclude EXTRA from sales/cash/qr/credit:
 *   EXTRA rows are NOTE rows — the real customer payment lives at the
 *   destination branch. Their price/cash/qr/credit are zero by DB
 *   constraint, but we still skip them defensively via {@link isExtraMethod}
 *   so that any cashier-typed variant (`extra-cl`, `EXTRA  CHU`, …) does
 *   not accidentally double-count if the constraint is ever loosened.
 *
 * Why Freelance contributes to `sales` but ALSO to `freelancePaid`:
 *   On a Freelance row, `staff` is the literal label `'Freelance'`,
 *   `freelancer_name` carries the ad-hoc person's name, and
 *   `freelancer_payout` is what we paid them. Customer payment columns
 *   (price, cash/qr/credit) carry what the customer paid us. So the
 *   row counts toward shop revenue (sales / payment column) AND the
 *   payout reduces NET via the `freelancePaid` deduction. NET is what
 *   the shop kept that day.
 *
 * Pure function. No I/O. Numeric coercion (`Number(…)`) defends against
 * Postgres `numeric` columns arriving as strings through supabase-js.
 *
 * Validates: new — owner ergonomics; supports Requirements 6.x, 8.x, 10.x.
 */

import { isExtraMethod } from './extra'
import type { TransactionRow } from './salary-board'
import type { Branch } from './row-id'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Subset of the `expenses` table row needed by the ledger. Field names
 * are camelCase to match the rest of the domain layer (the action layer
 * shapes raw `expenses` rows before they reach here — see
 * {@link import('../app/actions/writeExpense').PersistedExpense}).
 */
export interface ExpenseRow {
  branch: Branch
  /** `yyyy-MM-dd`, 5 AM KL cutoff applied at write time. */
  businessDate: string
  amount: number
}

export interface DailyLedgerRow {
  businessDate: string
  branch: Branch
  sales: number
  cash: number
  qr: number
  credit: number
  freelancePaid: number
  expense: number
  net: number
}

/**
 * Transaction shape consumed by the ledger. Extends the canonical
 * {@link TransactionRow} with the freelancer payout column added in
 * task 13.1. The field is optional so the ledger remains usable
 * before that migration ships (older rows read back as 0).
 */
export type LedgerTransactionRow = TransactionRow & {
  freelancerPayout?: number
}

export interface BuildDailyLedgerInput {
  transactions: ReadonlyArray<LedgerTransactionRow>
  expenses: ReadonlyArray<ExpenseRow>
  /**
   * Optional date filter. When supplied, only (date, branch) cells
   * whose `businessDate` is in this list are returned. When omitted,
   * the output covers every date that appears in transactions or
   * expenses.
   */
  dates?: ReadonlyArray<string>
  /**
   * Optional branch filter. When supplied, only rows whose `branch`
   * is in this list are returned.
   */
  branches?: ReadonlyArray<Branch>
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Branch sort order matches the rest of the app (Kimberry first,
 * then Bishop, then Chulia). Same order used by `salary-board.ts`.
 */
const BRANCH_ORDER: Record<Branch, number> = {
  Kimberry: 0,
  Bishop: 1,
  Chulia: 2,
}

function bucketKey(businessDate: string, branch: Branch): string {
  return `${businessDate}|${branch}`
}

function emptyRow(businessDate: string, branch: Branch): DailyLedgerRow {
  return {
    businessDate,
    branch,
    sales: 0,
    cash: 0,
    qr: 0,
    credit: 0,
    freelancePaid: 0,
    expense: 0,
    net: 0,
  }
}

function n(value: unknown): number {
  // `numeric` columns can arrive as strings via supabase-js; coerce
  // and treat NaN/undefined/null as 0 so a single bad cell can't
  // poison the whole ledger.
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isFreelanceMethod(method: string): boolean {
  return String(method ?? '').trim().toLowerCase() === 'freelance'
}

// ---------------------------------------------------------------------------
// buildDailyLedger
// ---------------------------------------------------------------------------

/**
 * Build the daily ledger from raw transactions and expenses.
 *
 * Algorithm:
 *   1. For each transaction:
 *        - if EXTRA-shaped, skip (NOTE row, no money moved here).
 *        - else add price → sales, cash → cash, qr → qr, credit → credit
 *          at the row's (businessDate, branch).
 *        - if method === 'Freelance', additionally add freelancerPayout
 *          → freelancePaid at the same key.
 *   2. For each expense, add amount → expense at (businessDate, branch).
 *   3. For each cell, compute net = sales − freelancePaid − expense.
 *   4. Apply optional `dates` / `branches` filters.
 *   5. Sort by businessDate ASC, then branch in canonical order.
 */
export function buildDailyLedger(
  input: BuildDailyLedgerInput,
): DailyLedgerRow[] {
  const cells: Record<string, DailyLedgerRow> = {}

  const dateFilter = input.dates ? new Set(input.dates) : null
  const branchFilter = input.branches ? new Set(input.branches) : null

  function ensureCell(date: string, branch: Branch): DailyLedgerRow {
    const key = bucketKey(date, branch)
    let cell = cells[key]
    if (!cell) {
      cell = emptyRow(date, branch)
      cells[key] = cell
    }
    return cell
  }

  // --- 1. Transactions -----------------------------------------------------
  for (const row of input.transactions) {
    const method = String(row.method ?? '')
    if (isExtraMethod(method)) continue

    const cell = ensureCell(row.businessDate, row.branch)
    cell.sales += n(row.price)
    cell.cash += n(row.cash)
    cell.qr += n(row.qr)
    cell.credit += n(row.credit)

    if (isFreelanceMethod(method)) {
      cell.freelancePaid += n(row.freelancerPayout)
    }
  }

  // --- 2. Expenses ---------------------------------------------------------
  for (const exp of input.expenses) {
    const cell = ensureCell(exp.businessDate, exp.branch)
    cell.expense += n(exp.amount)
  }

  // --- 3. NET + 4. Filters + 5. Sort --------------------------------------
  const out: DailyLedgerRow[] = []
  for (const key of Object.keys(cells)) {
    const cell = cells[key]
    cell.net = cell.sales - cell.freelancePaid - cell.expense
    if (dateFilter && !dateFilter.has(cell.businessDate)) continue
    if (branchFilter && !branchFilter.has(cell.branch)) continue
    out.push(cell)
  }

  out.sort((a, b) => {
    if (a.businessDate !== b.businessDate) {
      return a.businessDate < b.businessDate ? -1 : 1
    }
    return BRANCH_ORDER[a.branch] - BRANCH_ORDER[b.branch]
  })

  return out
}
