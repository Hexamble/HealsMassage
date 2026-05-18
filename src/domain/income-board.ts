/**
 * Income board domain — per (branch × business_date) financial roll-up
 * and the monthly grid used by the Boss HQ Shop Income Board.
 *
 * Pure functions, no I/O. Encodes the algorithm from
 * `c:/BILL/.kiro/specs/heals-system-rebuild/design.md`
 * §"Income Board Computation" and Requirements 11.1–11.5, 17.5.
 *
 * Algorithm — for each (branch, businessDate) cell:
 *
 *   sales        = Σ price            over non-freelance transactions
 *   cash         = Σ cash             over non-freelance transactions
 *   qr           = Σ qr               over non-freelance transactions
 *   credit       = Σ credit           over non-freelance transactions
 *   collected    = cash + qr
 *   freelance    = Σ totalCommission  over freelance transactions
 *   expenses     = Σ amount           over expense rows
 *   netIncome    = collected − freelance − expenses
 *   sessions     = count              of non-freelance transactions
 *
 * Notes on EXTRA rows:
 *   Per Requirement 11.5 + DB CHECK constraints, EXTRA rows have
 *   `price = cash = qr = credit = 0`, so they contribute 0 to every
 *   payment column without needing an explicit filter. Per the design
 *   the `sessions` field counts every non-freelance transaction, so
 *   EXTRA rows DO add 1 to `sessions` at the branch where they are
 *   logged. (EXTRA mirrors live at the staff's home branch and are a
 *   distinct row from the source real transaction at the work branch,
 *   so per-branch counts do not double-count globally.)
 *
 * Freelance rows are kept separate from the per-staff salary picture
 * (Requirement 18.2) and from `sales`/payment columns here. The
 * freelancer's payout, computed via the freelance rate table in
 * `commission.ts` and persisted in `total_commission`, is summed into
 * the dedicated `freelance` deduction line and subtracted from
 * `collected` to produce `netIncome`.
 *
 * Numeric coercion via `n(...)` defends against Postgres `numeric`
 * columns arriving as strings through supabase-js (a single bad cell
 * can't poison the entire roll-up).
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 17.5.
 */

import type {
  Branch,
  DayBranchIncome,
  ExpenseRow,
  TransactionRow,
} from './types'
// `isExtraMethod` is intentionally not imported here: EXTRA rows are
// already zero-filled on price/cash/qr/credit at write time
// (Req 2.5 + DB CHECK), and the design counts them in `sessions`. If a
// future regression weakens those constraints, add a defensive guard.

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const FREELANCE_TAG = 'freelance'

/**
 * True when `method` is the `Freelance` literal (case- and
 * whitespace-tolerant). Kept local — the salary board has its own
 * matching helper, and pulling the check into `extra.ts` would
 * conflate two unrelated method-routing concerns.
 */
function isFreelanceMethod(method: unknown): boolean {
  return String(method ?? '').trim().toLowerCase() === FREELANCE_TAG
}

/**
 * Coerce an arbitrary value to a finite number. Treats NaN, Infinity,
 * null, undefined, and non-numeric strings as 0. Mirrors the helper in
 * `daily-ledger.ts` so the ledger and the income board agree on how
 * to read malformed numeric cells.
 */
function n(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function emptyDay(): DayBranchIncome {
  return {
    sales: 0,
    cash: 0,
    qr: 0,
    credit: 0,
    collected: 0,
    freelance: 0,
    expenses: 0,
    netIncome: 0,
    sessions: 0,
  }
}

// ---------------------------------------------------------------------------
// computeDayBranchIncome
// ---------------------------------------------------------------------------

/**
 * Compute the income roll-up for a single (branch × businessDate).
 *
 * Rows in `transactions` and `expenses` outside the target (branch, date)
 * are silently ignored, so callers may pass full-day or full-month
 * arrays without pre-filtering. The function never mutates its inputs.
 *
 * Time-complexity: O(N + M) where N = transactions and M = expenses.
 */
export function computeDayBranchIncome(
  transactions: ReadonlyArray<TransactionRow>,
  expenses: ReadonlyArray<ExpenseRow>,
  branch: Branch,
  businessDate: string,
): DayBranchIncome {
  const cell = emptyDay()

  for (const row of transactions) {
    if (row.branch !== branch) continue
    if (row.businessDate !== businessDate) continue

    if (isFreelanceMethod(row.method)) {
      cell.freelance += n(row.totalCommission)
      continue
    }

    // Non-freelance branch: includes CASH/QR/CREDIT real rows and EXTRA
    // mirror rows. EXTRA rows are zero-filled on every payment column
    // (Req 2.5 + DB CHECK) so they add nothing to sales/cash/qr/credit;
    // they DO add 1 to `sessions` per the design contract.
    cell.sales += n(row.price)
    cell.cash += n(row.cash)
    cell.qr += n(row.qr)
    cell.credit += n(row.credit)
    cell.sessions += 1
  }

  for (const exp of expenses) {
    if (exp.branch !== branch) continue
    if (exp.businessDate !== businessDate) continue
    cell.expenses += n(exp.amount)
  }

  cell.collected = cell.cash + cell.qr
  cell.netIncome = cell.collected - cell.freelance - cell.expenses
  return cell
}

// ---------------------------------------------------------------------------
// computeMonthIncomeBoard
// ---------------------------------------------------------------------------

/**
 * Per-day per-branch income grid for the Boss HQ Shop Income Board
 * (Requirement 11.1).
 *
 * Returns a nested map keyed by `businessDate` → `branch` →
 * {@link DayBranchIncome}. Every (date, branch) pair in the cartesian
 * product of `monthDates` × `branches` is materialised, so cells with
 * no activity appear as zeroed rows. This keeps the rendered table
 * dense (one row per day, one column per branch) without the page
 * needing to fill gaps.
 *
 * Callers requiring a sparse view should filter the result. Callers
 * needing monthly totals can `Object.values(...)` and reduce.
 *
 * @example
 *   const grid = computeMonthIncomeBoard(txns, expenses,
 *     ['Kimberry', 'Bishop', 'Chulia'], cycle.days)
 *   const kim15 = grid['2026-05-15'].Kimberry
 */
export function computeMonthIncomeBoard(
  transactions: ReadonlyArray<TransactionRow>,
  expenses: ReadonlyArray<ExpenseRow>,
  branches: ReadonlyArray<Branch>,
  monthDates: ReadonlyArray<string>,
): Record<string, Record<Branch, DayBranchIncome>> {
  const result: Record<string, Record<Branch, DayBranchIncome>> = {}
  for (const date of monthDates) {
    const perBranch = {} as Record<Branch, DayBranchIncome>
    for (const branch of branches) {
      perBranch[branch] = computeDayBranchIncome(
        transactions,
        expenses,
        branch,
        date,
      )
    }
    result[date] = perBranch
  }
  return result
}
