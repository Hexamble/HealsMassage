/**
 * Tests for `aggregateDay` — the pure-TS mirror of the SQL
 * `take_daily_snapshot(p_date)` function.
 *
 * Two property tests cover the universal invariants we need to trust
 * before reading from `daily_snapshots` on the past-day pages:
 *
 *   - Property 27 — Snapshot idempotency. Calling `aggregateDay`
 *     twice on the same data yields the same row. This mirrors the
 *     SQL function's `ON CONFLICT (...) DO UPDATE` semantics: a
 *     re-snapshot for the same (date, branch) overwrites with the
 *     same numbers.
 *   - Property 28 — Snapshot consistency. The output equals
 *     sum(price) / sum(commission) / count(*) etc. computed
 *     independently over the same input set. This guarantees the
 *     snapshot is a faithful trailing summary, not a stale or
 *     drifted copy of "today" totals.
 *
 * Validates: Requirements 14.x (archival), tasks.md 21.7. Property 27
 * and 28 referenced from design.md §21.5.
 */

import fc from 'fast-check'
import {
  aggregateDay,
  type SnapshotExpenseRow,
  type SnapshotTransactionRow,
} from './daily-snapshots'
import { isExtraMethod } from './extra'
import type { Branch } from './row-id'

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const BRANCHES: Branch[] = ['Kimberry', 'Bishop', 'Chulia']
const REAL_METHODS = ['CASH', 'QR', 'CREDIT'] as const
const EXTRA_METHODS = ['EXTRA KM', 'EXTRA BS', 'EXTRA CL'] as const

const branchArb: fc.Arbitrary<Branch> = fc.constantFrom(...BRANCHES)
const dateArb: fc.Arbitrary<string> = fc.constantFrom(
  '2026-05-13',
  '2026-05-14',
  '2026-05-15',
  '2026-05-16',
)

/**
 * Money values are bounded to a 4-digit MYR range and rounded to 2 dp
 * so the property assertions can compare with exact equality. Real
 * numeric DB columns are `numeric(10,2)` so the rounding mirrors the
 * stored precision.
 */
const moneyArb: fc.Arbitrary<number> = fc
  .integer({ min: 0, max: 50000 })
  .map((cents) => cents / 100)

const realRowArb: fc.Arbitrary<SnapshotTransactionRow> = fc
  .record({
    branch: branchArb,
    businessDate: dateArb,
    method: fc.constantFrom(...REAL_METHODS),
    price: moneyArb,
    cash: moneyArb,
    qr: moneyArb,
    credit: moneyArb,
    commission: moneyArb,
  })
  .map((r) => r as SnapshotTransactionRow)

const extraRowArb: fc.Arbitrary<SnapshotTransactionRow> = fc
  .record({
    branch: branchArb,
    businessDate: dateArb,
    method: fc.constantFrom(...EXTRA_METHODS),
    // EXTRA rows carry zero money by DB constraint; mirror that here.
    price: fc.constant(0),
    cash: fc.constant(0),
    qr: fc.constant(0),
    credit: fc.constant(0),
    commission: moneyArb,
  })
  .map((r) => r as SnapshotTransactionRow)

const txRowArb = fc.oneof(realRowArb, extraRowArb)

const expenseRowArb: fc.Arbitrary<SnapshotExpenseRow> = fc.record({
  branch: branchArb,
  businessDate: dateArb,
  amount: moneyArb,
})

// ---------------------------------------------------------------------------
// Independent reference implementation — used by Property 28 to verify
// the aggregator's output against a separate, naive computation. Keeping
// this reference dead-simple (no shared helpers) limits the chance of a
// shared bug masking a real divergence.
// ---------------------------------------------------------------------------

interface ExpectedTotals {
  sales: number
  cash: number
  qr: number
  credit: number
  sessions: number
  commission: number
  expenses: number
}

function computeExpected(
  rows: ReadonlyArray<SnapshotTransactionRow>,
  expenses: ReadonlyArray<SnapshotExpenseRow>,
  branch: Branch,
  date: string,
): ExpectedTotals {
  let sales = 0
  let cash = 0
  let qr = 0
  let credit = 0
  let sessions = 0
  let commission = 0
  let expenseTotal = 0

  for (const row of rows) {
    if (row.branch !== branch) continue
    if (row.businessDate !== date) continue
    commission += Number(row.commission ?? 0)
    if (isExtraMethod(String(row.method ?? ''))) continue
    sales += Number(row.price ?? 0)
    cash += Number(row.cash ?? 0)
    qr += Number(row.qr ?? 0)
    credit += Number(row.credit ?? 0)
    sessions += 1
  }
  for (const exp of expenses) {
    if (exp.branch !== branch) continue
    if (exp.businessDate !== date) continue
    expenseTotal += Number(exp.amount ?? 0)
  }
  return {
    sales,
    cash,
    qr,
    credit,
    sessions,
    commission,
    expenses: expenseTotal,
  }
}

/**
 * Floats accumulated via repeated `+=` can drift by ulps even when
 * inputs are 2-dp values. We compare to 6 dp tolerance, which is well
 * inside the `numeric(12,2)` precision of the snapshot column.
 */
function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6
}

// ---------------------------------------------------------------------------
// Examples — sanity checks before the property tests so a regression
// shows up with a tiny, readable failure.
// ---------------------------------------------------------------------------

describe('aggregateDay — examples', () => {
  it('two real rows + one expense at the same (date, branch)', () => {
    const rows: SnapshotTransactionRow[] = [
      {
        branch: 'Kimberry',
        businessDate: '2026-05-15',
        method: 'CASH',
        price: 80,
        cash: 80,
        qr: 0,
        credit: 0,
        commission: 23,
      },
      {
        branch: 'Kimberry',
        businessDate: '2026-05-15',
        method: 'QR',
        price: 100,
        cash: 0,
        qr: 100,
        credit: 0,
        commission: 30,
      },
    ]
    const expenses: SnapshotExpenseRow[] = [
      {
        branch: 'Kimberry',
        businessDate: '2026-05-15',
        amount: 50,
      },
    ]

    const out = aggregateDay(rows, expenses, 'Kimberry', '2026-05-15')

    expect(out).toMatchObject({
      branch: 'Kimberry',
      sales: 180,
      cash: 80,
      qr: 100,
      credit: 0,
      sessions: 2,
      commission: 53,
      expenses: 50,
      net: 130,
    })
  })

  it('EXTRA rows contribute commission only (no sales / sessions)', () => {
    const rows: SnapshotTransactionRow[] = [
      {
        branch: 'Bishop',
        businessDate: '2026-05-15',
        method: 'EXTRA KM',
        price: 0,
        cash: 0,
        qr: 0,
        credit: 0,
        commission: 23,
      },
    ]

    const out = aggregateDay(rows, [], 'Bishop', '2026-05-15')

    expect(out.sales).toBe(0)
    expect(out.sessions).toBe(0)
    expect(out.commission).toBe(23)
    expect(out.net).toBe(0)
  })

  it('rows for other dates / branches are ignored', () => {
    const rows: SnapshotTransactionRow[] = [
      {
        branch: 'Kimberry',
        businessDate: '2026-05-14', // wrong date
        method: 'CASH',
        price: 999,
        cash: 999,
        qr: 0,
        credit: 0,
        commission: 999,
      },
      {
        branch: 'Bishop', // wrong branch
        businessDate: '2026-05-15',
        method: 'CASH',
        price: 999,
        cash: 999,
        qr: 0,
        credit: 0,
        commission: 999,
      },
    ]

    const out = aggregateDay(rows, [], 'Kimberry', '2026-05-15')

    expect(out).toMatchObject({
      sales: 0,
      cash: 0,
      qr: 0,
      credit: 0,
      sessions: 0,
      commission: 0,
      expenses: 0,
      net: 0,
    })
  })

  it('numeric strings (PostgREST shape) are coerced to numbers', () => {
    const rows: SnapshotTransactionRow[] = [
      {
        branch: 'Chulia',
        businessDate: '2026-05-15',
        method: 'CASH',
        price: '120.50',
        cash: '120.50',
        qr: 0,
        credit: 0,
        commission: '36.00',
      },
    ]

    const out = aggregateDay(rows, [], 'Chulia', '2026-05-15')
    expect(out.sales).toBeCloseTo(120.5, 5)
    expect(out.commission).toBeCloseTo(36, 5)
  })
})

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('aggregateDay — properties', () => {
  /**
   * Property 27 — Snapshot idempotency.
   *
   * `aggregateDay` is a pure function over its inputs, so calling it
   * twice with the same arguments produces the same output. This is
   * the in-process mirror of the SQL function's UPSERT semantics:
   * `ON CONFLICT (business_date, branch) DO UPDATE SET ...` writes
   * the same numbers on the second call.
   *
   * Validates: Requirements 14.x (archival), Property 27.
   */
  it('Property 27 — calling aggregateDay twice yields the same row', () => {
    fc.assert(
      fc.property(
        fc.array(txRowArb, { maxLength: 30 }),
        fc.array(expenseRowArb, { maxLength: 10 }),
        branchArb,
        dateArb,
        (rows, expenses, branch, date) => {
          const first = aggregateDay(rows, expenses, branch, date)
          const second = aggregateDay(rows, expenses, branch, date)
          expect(second).toEqual(first)
        },
      ),
      { numRuns: 200 },
    )
  })

  /**
   * Property 28 — Snapshot consistency.
   *
   * The aggregator's output equals an independently-computed sum
   * over the same input set. We don't compare commission against
   * real-only rows (the design specifies summing over ALL rows for
   * commission), so the reference implementation matches that rule.
   *
   * Validates: Requirements 14.x, Property 28.
   */
  it('Property 28 — totals match independent sum/count over the input', () => {
    fc.assert(
      fc.property(
        fc.array(txRowArb, { maxLength: 30 }),
        fc.array(expenseRowArb, { maxLength: 10 }),
        branchArb,
        dateArb,
        (rows, expenses, branch, date) => {
          const out = aggregateDay(rows, expenses, branch, date)
          const expected = computeExpected(rows, expenses, branch, date)

          expect(approxEqual(out.sales, expected.sales)).toBe(true)
          expect(approxEqual(out.cash, expected.cash)).toBe(true)
          expect(approxEqual(out.qr, expected.qr)).toBe(true)
          expect(approxEqual(out.credit, expected.credit)).toBe(true)
          expect(out.sessions).toBe(expected.sessions)
          expect(approxEqual(out.commission, expected.commission)).toBe(true)
          expect(approxEqual(out.expenses, expected.expenses)).toBe(true)
          expect(approxEqual(out.net, expected.sales - expected.expenses)).toBe(
            true,
          )
        },
      ),
      { numRuns: 200 },
    )
  })
})
