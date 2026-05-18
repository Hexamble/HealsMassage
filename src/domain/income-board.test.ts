/**
 * Unit tests for `income-board.ts`.
 *
 * Covers the Shop Income Board contract published in
 * `c:/BILL/.kiro/specs/heals-system-rebuild/design.md`
 * §"Income Board Computation" and validates Requirements 11.1, 11.2,
 * 11.3, 11.4, 11.5, 17.5.
 *
 * The example tests pin down:
 *   - basic per-cell sums for CASH / QR / CREDIT non-freelance rows
 *   - EXTRA rows contribute 0 to sales/cash/qr/credit but count in
 *     `sessions` (Req 11.5; design "sessions = count of non-freelance")
 *   - Freelance rows are excluded from sales and `sessions`, but their
 *     `totalCommission` is summed into the `freelance` deduction line
 *   - Expenses subtract from `netIncome` (Req 17.5)
 *   - Multi-day month rollup materialises every (date × branch) cell
 *     including empty ones (zeroed)
 *   - Cross-branch / cross-date noise rows are ignored
 *
 * Property-style tests for the formula identity live in
 * `income-board.property.test.ts` (task 4.9, optional). This file
 * focuses on deterministic example fixtures.
 */

import { computeDayBranchIncome, computeMonthIncomeBoard } from './income-board'
import type {
  Branch,
  ExpenseRow,
  TransactionRow,
} from './types'

// ---------------------------------------------------------------------------
// Test fixture factories
// ---------------------------------------------------------------------------

let __seq = 0

interface TxOverrides {
  branch: Branch
  businessDate: string
  method: string
  price?: number
  cash?: number
  qr?: number
  credit?: number
  totalCommission?: number
  cashierRowNumber?: number
  staff?: string
}

function makeTx(o: TxOverrides): TransactionRow {
  __seq += 1
  return {
    id: `tx-${__seq}`,
    branch: o.branch,
    businessDate: o.businessDate,
    cashierRowNumber: o.cashierRowNumber ?? __seq,
    staff: o.staff ?? 'Tester',
    course: 'FR',
    duration: 60,
    timeIn: null,
    timeOut: null,
    method: o.method,
    addon: 0,
    baseCommission: 0,
    balmBonus: 0,
    bookingBonus: 0,
    totalCommission: o.totalCommission ?? 0,
    cash: o.cash ?? 0,
    qr: o.qr ?? 0,
    credit: o.credit ?? 0,
    price: o.price ?? 0,
    flags: '',
    comment: '',
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-05-15T10:00:00.000Z',
    createdBy: null,
  }
}

interface ExpenseOverrides {
  branch: Branch
  businessDate: string
  amount: number
  item?: string
}

function makeExpense(o: ExpenseOverrides): ExpenseRow {
  __seq += 1
  return {
    id: `exp-${__seq}`,
    branch: o.branch,
    businessDate: o.businessDate,
    item: o.item ?? 'Supplies',
    amount: o.amount,
    method: 'CASH',
    note: '',
    source: 'Cashier',
    createdAt: '2026-05-15T10:00:00.000Z',
    createdBy: null,
  }
}

// ---------------------------------------------------------------------------
// computeDayBranchIncome — Requirements 11.1–11.5, 17.5
// ---------------------------------------------------------------------------

describe('computeDayBranchIncome — basic sums', () => {
  it('empty input → all zeroes', () => {
    const out = computeDayBranchIncome([], [], 'Kimberry', '2026-05-15')
    expect(out).toEqual({
      sales: 0,
      cash: 0,
      qr: 0,
      credit: 0,
      collected: 0,
      freelance: 0,
      expenses: 0,
      netIncome: 0,
      sessions: 0,
    })
  })

  it('mixed CASH / QR / CREDIT non-freelance rows sum correctly', () => {
    const txns: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'CASH', price: 100, cash: 100 }),
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'QR', price: 80, qr: 80 }),
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'CREDIT', price: 50, credit: 50 }),
    ]
    const out = computeDayBranchIncome(txns, [], 'Kimberry', '2026-05-15')
    expect(out.sales).toBe(230)
    expect(out.cash).toBe(100)
    expect(out.qr).toBe(80)
    expect(out.credit).toBe(50)
    expect(out.collected).toBe(180) // cash + qr
    expect(out.freelance).toBe(0)
    expect(out.expenses).toBe(0)
    expect(out.netIncome).toBe(180) // 180 - 0 - 0
    expect(out.sessions).toBe(3)
  })

  it('split-payment row counts each column once', () => {
    // A single 100 RM session paid 60 cash + 40 QR.
    const txns: TransactionRow[] = [
      makeTx({
        branch: 'Bishop',
        businessDate: '2026-05-15',
        method: 'CASH',
        price: 100,
        cash: 60,
        qr: 40,
      }),
    ]
    const out = computeDayBranchIncome(txns, [], 'Bishop', '2026-05-15')
    expect(out.sales).toBe(100)
    expect(out.cash).toBe(60)
    expect(out.qr).toBe(40)
    expect(out.collected).toBe(100)
    expect(out.sessions).toBe(1)
  })

  it('ignores rows from other branches and other dates', () => {
    const txns: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'CASH', price: 100, cash: 100 }),
      // noise: same date, different branch
      makeTx({ branch: 'Bishop', businessDate: '2026-05-15', method: 'CASH', price: 999, cash: 999 }),
      // noise: same branch, different date
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-16', method: 'CASH', price: 999, cash: 999 }),
    ]
    const out = computeDayBranchIncome(txns, [], 'Kimberry', '2026-05-15')
    expect(out.sales).toBe(100)
    expect(out.sessions).toBe(1)
  })
})

describe('computeDayBranchIncome — EXTRA rows (Requirement 11.5)', () => {
  it('EXTRA rows contribute 0 to sales/cash/qr/credit but count as a session', () => {
    // Per design: EXTRA rows are non-freelance, so they ARE in `sessions`.
    // Per Req 11.5 + DB constraint: EXTRA rows have price=cash=qr=credit=0,
    // so they contribute 0 to every payment column.
    const txns: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'CASH', price: 100, cash: 100 }),
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'EXTRA BS' }),
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'EXTRA CL' }),
    ]
    const out = computeDayBranchIncome(txns, [], 'Kimberry', '2026-05-15')
    expect(out.sales).toBe(100)
    expect(out.cash).toBe(100)
    expect(out.qr).toBe(0)
    expect(out.credit).toBe(0)
    expect(out.collected).toBe(100)
    expect(out.sessions).toBe(3) // 1 real + 2 EXTRA
    expect(out.netIncome).toBe(100)
  })

  it('a day of only EXTRA rows yields zero sales but non-zero session count', () => {
    const txns: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'EXTRA BS' }),
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'EXTRA CL' }),
    ]
    const out = computeDayBranchIncome(txns, [], 'Kimberry', '2026-05-15')
    expect(out.sales).toBe(0)
    expect(out.sessions).toBe(2)
    expect(out.netIncome).toBe(0)
  })
})

describe('computeDayBranchIncome — Freelance rows (Requirement 18.2/18.3)', () => {
  it('Freelance rows are excluded from sales and sessions, but feed the freelance line', () => {
    const txns: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'CASH', price: 100, cash: 100 }),
      makeTx({
        branch: 'Kimberry',
        businessDate: '2026-05-15',
        method: 'Freelance',
        price: 80,
        cash: 80,
        totalCommission: 25,
      }),
    ]
    const out = computeDayBranchIncome(txns, [], 'Kimberry', '2026-05-15')
    // Sales counts only the non-freelance row.
    expect(out.sales).toBe(100)
    // Payment columns include only the non-freelance row's split.
    expect(out.cash).toBe(100)
    expect(out.qr).toBe(0)
    expect(out.collected).toBe(100)
    // Freelance commission is summed into the deduction line.
    expect(out.freelance).toBe(25)
    // Sessions excludes freelance.
    expect(out.sessions).toBe(1)
    // netIncome = collected − freelance − expenses
    expect(out.netIncome).toBe(75)
  })

  it('multiple freelance rows accumulate their totalCommission', () => {
    const txns: TransactionRow[] = [
      makeTx({
        branch: 'Bishop',
        businessDate: '2026-05-15',
        method: 'Freelance',
        price: 100,
        totalCommission: 30,
      }),
      makeTx({
        branch: 'Bishop',
        businessDate: '2026-05-15',
        method: 'freelance', // case-insensitive
        price: 100,
        totalCommission: 20,
      }),
    ]
    const out = computeDayBranchIncome(txns, [], 'Bishop', '2026-05-15')
    expect(out.sales).toBe(0)
    expect(out.sessions).toBe(0)
    expect(out.freelance).toBe(50)
    expect(out.netIncome).toBe(-50) // collected (0) - freelance (50) - expenses (0)
  })
})

describe('computeDayBranchIncome — expenses (Requirement 17.5)', () => {
  it('expenses subtract from netIncome', () => {
    const txns: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'CASH', price: 200, cash: 200 }),
    ]
    const expenses: ExpenseRow[] = [
      makeExpense({ branch: 'Kimberry', businessDate: '2026-05-15', amount: 30 }),
      makeExpense({ branch: 'Kimberry', businessDate: '2026-05-15', amount: 20 }),
    ]
    const out = computeDayBranchIncome(txns, expenses, 'Kimberry', '2026-05-15')
    expect(out.expenses).toBe(50)
    expect(out.netIncome).toBe(150) // 200 collected - 0 freelance - 50 expenses
  })

  it('ignores expenses from other branches/dates', () => {
    const expenses: ExpenseRow[] = [
      makeExpense({ branch: 'Kimberry', businessDate: '2026-05-15', amount: 30 }),
      makeExpense({ branch: 'Bishop', businessDate: '2026-05-15', amount: 999 }),
      makeExpense({ branch: 'Kimberry', businessDate: '2026-05-16', amount: 999 }),
    ]
    const out = computeDayBranchIncome([], expenses, 'Kimberry', '2026-05-15')
    expect(out.expenses).toBe(30)
    expect(out.netIncome).toBe(-30)
  })

  it('full mix: real + freelance + EXTRA + expenses', () => {
    // Kimberry / 2026-05-15:
    //   CASH 100, QR 50, EXTRA 0, Freelance(payout 25) on price 80 in cash
    //   expense 20.
    //   sales = 100 + 50 = 150 (freelance excluded; EXTRA is 0)
    //   cash = 100 (freelance cash NOT counted toward sales/cash columns)
    //   qr = 50; credit = 0; collected = 150
    //   freelance = 25; expenses = 20
    //   net = 150 - 25 - 20 = 105
    //   sessions = 3 (1 CASH + 1 QR + 1 EXTRA; freelance excluded)
    const txns: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'CASH', price: 100, cash: 100 }),
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'QR', price: 50, qr: 50 }),
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'EXTRA BS' }),
      makeTx({
        branch: 'Kimberry',
        businessDate: '2026-05-15',
        method: 'Freelance',
        price: 80,
        cash: 80,
        totalCommission: 25,
      }),
    ]
    const expenses: ExpenseRow[] = [
      makeExpense({ branch: 'Kimberry', businessDate: '2026-05-15', amount: 20 }),
    ]
    const out = computeDayBranchIncome(txns, expenses, 'Kimberry', '2026-05-15')
    expect(out.sales).toBe(150)
    expect(out.cash).toBe(100)
    expect(out.qr).toBe(50)
    expect(out.credit).toBe(0)
    expect(out.collected).toBe(150)
    expect(out.freelance).toBe(25)
    expect(out.expenses).toBe(20)
    expect(out.netIncome).toBe(105)
    expect(out.sessions).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// computeMonthIncomeBoard — Requirements 11.1
// ---------------------------------------------------------------------------

describe('computeMonthIncomeBoard — multi-day per-branch grid', () => {
  const BRANCHES: Branch[] = ['Kimberry', 'Bishop', 'Chulia']

  it('materialises every (date × branch) cell, zeroing empty cells', () => {
    const dates = ['2026-05-15', '2026-05-16']
    const grid = computeMonthIncomeBoard([], [], BRANCHES, dates)

    expect(Object.keys(grid).sort()).toEqual(dates)
    for (const date of dates) {
      expect(Object.keys(grid[date]).sort()).toEqual(['Bishop', 'Chulia', 'Kimberry'])
      for (const branch of BRANCHES) {
        expect(grid[date][branch]).toEqual({
          sales: 0,
          cash: 0,
          qr: 0,
          credit: 0,
          collected: 0,
          freelance: 0,
          expenses: 0,
          netIncome: 0,
          sessions: 0,
        })
      }
    }
  })

  it('rolls up across multiple days and branches independently', () => {
    // Day 15: Kimberry 100 cash, Bishop 50 qr, Chulia empty.
    // Day 16: Kimberry expense 20 only, Bishop 60 credit, Chulia freelance(15).
    const txns: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-15', method: 'CASH', price: 100, cash: 100 }),
      makeTx({ branch: 'Bishop', businessDate: '2026-05-15', method: 'QR', price: 50, qr: 50 }),
      makeTx({ branch: 'Bishop', businessDate: '2026-05-16', method: 'CREDIT', price: 60, credit: 60 }),
      makeTx({
        branch: 'Chulia',
        businessDate: '2026-05-16',
        method: 'Freelance',
        price: 80,
        cash: 80,
        totalCommission: 15,
      }),
    ]
    const expenses: ExpenseRow[] = [
      makeExpense({ branch: 'Kimberry', businessDate: '2026-05-16', amount: 20 }),
    ]
    const dates = ['2026-05-15', '2026-05-16']
    const grid = computeMonthIncomeBoard(txns, expenses, BRANCHES, dates)

    // Day 15 / Kimberry
    expect(grid['2026-05-15'].Kimberry.sales).toBe(100)
    expect(grid['2026-05-15'].Kimberry.cash).toBe(100)
    expect(grid['2026-05-15'].Kimberry.collected).toBe(100)
    expect(grid['2026-05-15'].Kimberry.netIncome).toBe(100)
    expect(grid['2026-05-15'].Kimberry.sessions).toBe(1)

    // Day 15 / Bishop
    expect(grid['2026-05-15'].Bishop.sales).toBe(50)
    expect(grid['2026-05-15'].Bishop.qr).toBe(50)
    expect(grid['2026-05-15'].Bishop.collected).toBe(50)
    expect(grid['2026-05-15'].Bishop.netIncome).toBe(50)
    expect(grid['2026-05-15'].Bishop.sessions).toBe(1)

    // Day 15 / Chulia — empty
    expect(grid['2026-05-15'].Chulia.sales).toBe(0)
    expect(grid['2026-05-15'].Chulia.sessions).toBe(0)
    expect(grid['2026-05-15'].Chulia.netIncome).toBe(0)

    // Day 16 / Kimberry — expense only
    expect(grid['2026-05-16'].Kimberry.sales).toBe(0)
    expect(grid['2026-05-16'].Kimberry.expenses).toBe(20)
    expect(grid['2026-05-16'].Kimberry.netIncome).toBe(-20)
    expect(grid['2026-05-16'].Kimberry.sessions).toBe(0)

    // Day 16 / Bishop
    expect(grid['2026-05-16'].Bishop.sales).toBe(60)
    expect(grid['2026-05-16'].Bishop.credit).toBe(60)
    expect(grid['2026-05-16'].Bishop.collected).toBe(0) // credit not in collected
    expect(grid['2026-05-16'].Bishop.netIncome).toBe(0) // 0 - 0 - 0
    expect(grid['2026-05-16'].Bishop.sessions).toBe(1)

    // Day 16 / Chulia — freelance only
    expect(grid['2026-05-16'].Chulia.sales).toBe(0)
    expect(grid['2026-05-16'].Chulia.freelance).toBe(15)
    expect(grid['2026-05-16'].Chulia.sessions).toBe(0)
    expect(grid['2026-05-16'].Chulia.netIncome).toBe(-15) // 0 - 15 - 0
  })

  it('respects the branch list — only requested branches appear', () => {
    const grid = computeMonthIncomeBoard(
      [],
      [],
      ['Kimberry'],
      ['2026-05-15'],
    )
    expect(Object.keys(grid['2026-05-15'])).toEqual(['Kimberry'])
  })
})
