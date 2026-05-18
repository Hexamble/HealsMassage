/**
 * Unit tests for `reports.ts`.
 *
 * Covers:
 *   - topEarners: descending order, freelance exclusion, EXTRA fallback
 *     reflected in totals, ties broken deterministically.
 *   - uncoveredExtras: returns exactly the EXTRA rows whose destination
 *     has no matching real row; covered EXTRAs and undecodable EXTRAs
 *     are excluded; same matching rules as the canonical view.
 *   - expenseBreakdown: per-branch totals, per-item grouping with trim,
 *     branch-order preservation, cycle-day filter.
 *   - payoutReport: per-branch grouping by attribution branch, EXTRA
 *     fallback puts the staff under the destination branch, freelance
 *     excluded, roster display names used when matched.
 *
 * Validates: Requirements 22.1, 22.2, 22.3, 22.5
 */

import { cycleDates } from './cycle'
import {
  expenseBreakdown,
  payoutReport,
  topEarners,
  uncoveredExtras,
} from './reports'
import type {
  Branch,
  ExpenseRow,
  StaffMember,
  TransactionRow,
} from './types'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let __seq = 0

interface TxOverrides {
  branch: Branch
  businessDate: string
  staff: string
  course?: TransactionRow['course']
  duration?: TransactionRow['duration']
  method: string
  totalCommission?: number
  price?: number
  cash?: number
  qr?: number
  credit?: number
}

function makeTx(o: TxOverrides): TransactionRow {
  __seq += 1
  return {
    id: `tx-${__seq}`,
    branch: o.branch,
    businessDate: o.businessDate,
    cashierRowNumber: __seq,
    staff: o.staff,
    course: o.course ?? 'FR',
    duration: o.duration ?? 60,
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

function makeExpense(o: {
  branch: Branch
  businessDate: string
  item: string
  amount: number
}): ExpenseRow {
  __seq += 1
  return {
    id: `exp-${__seq}`,
    branch: o.branch,
    businessDate: o.businessDate,
    item: o.item,
    amount: o.amount,
    method: 'CASH',
    note: '',
    source: 'Cashier',
    createdAt: '2026-05-15T10:00:00.000Z',
    createdBy: null,
  }
}

// May 2026 cycle: 2026-04-21 → 2026-05-20.
const cycle = cycleDates(4, 2026, 21)
const D = '2026-05-15'

// Roster used across tests. Mirrors the May 15 gold-standard fixture in
// salary-board.test.ts so these reports stay aligned with the salary board.
const roster: StaffMember[] = [
  { id: 's1', name: 'Beer', homeBranch: 'Kimberry', isFreelance: false, isActive: true },
  { id: 's2', name: 'Ney', homeBranch: 'Kimberry', isFreelance: false, isActive: true },
  { id: 's3', name: 'Nana', homeBranch: 'Kimberry', isFreelance: false, isActive: true },
  { id: 's4', name: 'Yui', homeBranch: 'Bishop', isFreelance: false, isActive: true },
  { id: 's5', name: 'Pim', homeBranch: 'Chulia', isFreelance: true, isActive: true },
]

// ---------------------------------------------------------------------------
// topEarners — Requirement 22.2
// ---------------------------------------------------------------------------

describe('topEarners — Requirement 22.2', () => {
  it('returns staff totals sorted descending', () => {
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Beer', method: 'CASH', price: 70, cash: 70, totalCommission: 23 }),
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Beer', method: 'QR', price: 100, qr: 100, totalCommission: 31 }),
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Ney', method: 'CREDIT', price: 98, credit: 98, totalCommission: 31 }),
      makeTx({ branch: 'Bishop', businessDate: D, staff: 'Yui', method: 'CREDIT', price: 68, credit: 68, totalCommission: 23 }),
    ]
    const result = topEarners(rows, cycle)
    expect(result).toEqual([
      { name: 'Beer', total: 54 },
      { name: 'Ney', total: 31 },
      { name: 'Yui', total: 23 },
    ])
  })

  it('excludes freelance rows', () => {
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Beer', method: 'CASH', totalCommission: 20 }),
      // Freelance row with a (would-be) commission — must NOT count toward Pim.
      makeTx({
        branch: 'Chulia',
        businessDate: D,
        staff: 'Pim',
        method: 'Freelance',
        price: 100,
        cash: 100,
        totalCommission: 999,
      }),
    ]
    const result = topEarners(rows, cycle)
    expect(result).toEqual([{ name: 'Beer', total: 20 }])
  })

  it('reflects EXTRA fallback in the totals (uncovered EXTRA credits the staff)', () => {
    // Beer logs a Kimberry CASH (23) AND an EXTRA CL with no Chulia coverage (31 fallback).
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Beer', method: 'CASH', totalCommission: 23 }),
      makeTx({
        branch: 'Kimberry',
        businessDate: D,
        staff: 'Beer',
        course: 'FR',
        duration: 90,
        method: 'EXTRA CL',
        totalCommission: 31,
      }),
    ]
    const result = topEarners(rows, cycle)
    expect(result).toEqual([{ name: 'Beer', total: 54 }])
  })

  it('drops covered EXTRAs (the matching real row already counts)', () => {
    // Nana: Kim CASH (31) + Kim EXTRA BS FR60 (23, COVERED by Bishop FR60) +
    //       Bishop FR60 (23). Total = 31 + 23 = 54 (the EXTRA disappears).
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Nana', course: 'DTM', duration: 60, method: 'CASH', totalCommission: 31 }),
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Nana', course: 'FR', duration: 60, method: 'EXTRA BS', totalCommission: 999 }),
      makeTx({ branch: 'Bishop', businessDate: D, staff: 'Nana', course: 'FR', duration: 60, method: 'CREDIT', totalCommission: 23 }),
    ]
    const result = topEarners(rows, cycle)
    expect(result).toEqual([{ name: 'Nana', total: 54 }])
  })

  it('breaks ties by staff name ascending (deterministic)', () => {
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Charlie', method: 'CASH', totalCommission: 50 }),
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Alice', method: 'CASH', totalCommission: 50 }),
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Bob', method: 'CASH', totalCommission: 50 }),
    ]
    const result = topEarners(rows, cycle)
    expect(result.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Charlie'])
  })

  it('ignores rows outside the cycle', () => {
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Beer', method: 'CASH', totalCommission: 23 }),
      // Outside cycle (cycle ends 2026-05-20).
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-21', staff: 'Beer', method: 'CASH', totalCommission: 999 }),
    ]
    const result = topEarners(rows, cycle)
    expect(result).toEqual([{ name: 'Beer', total: 23 }])
  })
})

// ---------------------------------------------------------------------------
// uncoveredExtras — Requirement 22.5
// ---------------------------------------------------------------------------

describe('uncoveredExtras — Requirement 22.5', () => {
  it('returns EXTRA rows whose destination has no matching real row', () => {
    const uncovered = makeTx({
      branch: 'Kimberry',
      businessDate: D,
      staff: 'Beer',
      course: 'FR',
      duration: 90,
      method: 'EXTRA CL',
      totalCommission: 31,
    })
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Beer', method: 'CASH', totalCommission: 23 }),
      uncovered,
    ]
    const result = uncoveredExtras(rows)
    expect(result).toEqual([uncovered])
  })

  it('drops EXTRA rows that are covered by a real row at the destination', () => {
    const covered = makeTx({
      branch: 'Kimberry',
      businessDate: D,
      staff: 'Nana',
      course: 'FR',
      duration: 60,
      method: 'EXTRA BS',
      totalCommission: 23,
    })
    const realAtDest = makeTx({
      branch: 'Bishop',
      businessDate: D,
      staff: 'Nana',
      course: 'FR',
      duration: 60,
      method: 'CREDIT',
      totalCommission: 23,
    })
    const result = uncoveredExtras([covered, realAtDest])
    expect(result).toEqual([])
  })

  it('matches case-insensitively on staff and tolerates whitespace', () => {
    // EXTRA logs `' nana '`, real at dest logs `'NANA'`. Same person.
    const extra = makeTx({
      branch: 'Kimberry',
      businessDate: D,
      staff: ' nana ',
      course: 'FR',
      duration: 60,
      method: 'EXTRA BS',
      totalCommission: 23,
    })
    const real = makeTx({
      branch: 'Bishop',
      businessDate: D,
      staff: 'NANA',
      course: 'FR',
      duration: 60,
      method: 'CREDIT',
      totalCommission: 23,
    })
    expect(uncoveredExtras([extra, real])).toEqual([])
  })

  it('does not include EXTRAs with undecodable destinations', () => {
    const malformed = makeTx({
      branch: 'Kimberry',
      businessDate: D,
      staff: 'Beer',
      method: 'EXTRA QQ',
      totalCommission: 23,
    })
    expect(uncoveredExtras([malformed])).toEqual([])
  })

  it('does not include non-EXTRA rows', () => {
    const real = makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Beer', method: 'CASH', totalCommission: 23 })
    const freelance = makeTx({
      branch: 'Chulia',
      businessDate: D,
      staff: 'Pim',
      method: 'Freelance',
      totalCommission: 50,
    })
    expect(uncoveredExtras([real, freelance])).toEqual([])
  })

  it('returns rows in input order (no stable-sort surprise)', () => {
    const e1 = makeTx({
      branch: 'Kimberry',
      businessDate: D,
      staff: 'Beer',
      course: 'FR',
      duration: 90,
      method: 'EXTRA CL',
      totalCommission: 31,
    })
    const e2 = makeTx({
      branch: 'Kimberry',
      businessDate: D,
      staff: 'Lin',
      course: 'FNS',
      duration: 90,
      method: 'EXTRA CL',
      totalCommission: 35,
    })
    const result = uncoveredExtras([e1, e2])
    expect(result).toEqual([e1, e2])
  })
})

// ---------------------------------------------------------------------------
// expenseBreakdown — Requirement 22.3
// ---------------------------------------------------------------------------

describe('expenseBreakdown — Requirement 22.3', () => {
  const BRANCHES: Branch[] = ['Kimberry', 'Bishop', 'Chulia']

  it('groups expenses by branch and item, sorted desc within each branch', () => {
    const expenses: ExpenseRow[] = [
      makeExpense({ branch: 'Kimberry', businessDate: D, item: 'Rent', amount: 200 }),
      makeExpense({ branch: 'Kimberry', businessDate: D, item: 'Supplies', amount: 50 }),
      makeExpense({ branch: 'Kimberry', businessDate: '2026-05-16', item: 'Supplies', amount: 30 }),
      makeExpense({ branch: 'Bishop', businessDate: D, item: 'Utilities', amount: 80 }),
    ]
    const result = expenseBreakdown(expenses, cycle, BRANCHES)
    expect(result).toEqual([
      {
        branch: 'Kimberry',
        total: 280,
        items: [
          { item: 'Rent', total: 200 },
          { item: 'Supplies', total: 80 },
        ],
      },
      {
        branch: 'Bishop',
        total: 80,
        items: [{ item: 'Utilities', total: 80 }],
      },
      {
        branch: 'Chulia',
        total: 0,
        items: [],
      },
    ])
  })

  it('emits an empty branch slice when no expenses match', () => {
    const result = expenseBreakdown([], cycle, BRANCHES)
    expect(result).toEqual([
      { branch: 'Kimberry', total: 0, items: [] },
      { branch: 'Bishop', total: 0, items: [] },
      { branch: 'Chulia', total: 0, items: [] },
    ])
  })

  it('ignores expenses outside the cycle window', () => {
    const expenses: ExpenseRow[] = [
      makeExpense({ branch: 'Kimberry', businessDate: D, item: 'Rent', amount: 200 }),
      makeExpense({ branch: 'Kimberry', businessDate: '2026-05-21', item: 'Rent', amount: 999 }),
    ]
    const result = expenseBreakdown(expenses, cycle, BRANCHES)
    expect(result[0]).toEqual({
      branch: 'Kimberry',
      total: 200,
      items: [{ item: 'Rent', total: 200 }],
    })
  })

  it('collapses items that differ only in surrounding whitespace', () => {
    const expenses: ExpenseRow[] = [
      makeExpense({ branch: 'Kimberry', businessDate: D, item: 'Rent', amount: 100 }),
      makeExpense({ branch: 'Kimberry', businessDate: D, item: ' Rent ', amount: 50 }),
    ]
    const result = expenseBreakdown(expenses, cycle, BRANCHES)
    expect(result[0].items).toEqual([{ item: 'Rent', total: 150 }])
  })

  it('respects the order of `branches` argument', () => {
    const expenses: ExpenseRow[] = [
      makeExpense({ branch: 'Bishop', businessDate: D, item: 'A', amount: 10 }),
      makeExpense({ branch: 'Kimberry', businessDate: D, item: 'B', amount: 20 }),
    ]
    const result = expenseBreakdown(expenses, cycle, ['Bishop', 'Kimberry'])
    expect(result.map((r) => r.branch)).toEqual(['Bishop', 'Kimberry'])
  })
})

// ---------------------------------------------------------------------------
// payoutReport — Requirement 22.1
// ---------------------------------------------------------------------------

describe('payoutReport — Requirement 22.1', () => {
  it('groups staff totals by attribution branch via the canonical view', () => {
    // Beer: Kim CASH (23), Kim EXTRA CL FR90 (31, fallback to Chulia).
    // Yui: Bishop CREDIT (23).
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Beer', method: 'CASH', totalCommission: 23 }),
      makeTx({
        branch: 'Kimberry',
        businessDate: D,
        staff: 'Beer',
        course: 'FR',
        duration: 90,
        method: 'EXTRA CL',
        totalCommission: 31,
      }),
      makeTx({ branch: 'Bishop', businessDate: D, staff: 'Yui', method: 'CREDIT', totalCommission: 23 }),
    ]
    const result = payoutReport(rows, roster, cycle)
    expect(result.Kimberry).toEqual([{ staff: 'Beer', total: 23 }])
    expect(result.Bishop).toEqual([{ staff: 'Yui', total: 23 }])
    expect(result.Chulia).toEqual([{ staff: 'Beer', total: 31 }])
  })

  it('drops covered EXTRAs — staff appears only at branches with non-zero canonical total', () => {
    // Nana: Kim DTM 60 (31, real at Kim), Kim EXTRA BS FR 60 (covered),
    //       Bishop FR 60 (23, real at Bishop).
    // Expected: Nana under Kimberry (31) and Bishop (23). Nothing at Chulia.
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Nana', course: 'DTM', duration: 60, method: 'CASH', totalCommission: 31 }),
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Nana', course: 'FR', duration: 60, method: 'EXTRA BS', totalCommission: 23 }),
      makeTx({ branch: 'Bishop', businessDate: D, staff: 'Nana', course: 'FR', duration: 60, method: 'CREDIT', totalCommission: 23 }),
    ]
    const result = payoutReport(rows, roster, cycle)
    expect(result.Kimberry).toEqual([{ staff: 'Nana', total: 31 }])
    expect(result.Bishop).toEqual([{ staff: 'Nana', total: 23 }])
    expect(result.Chulia).toEqual([])
  })

  it('excludes freelance rows from every branch slice', () => {
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Beer', method: 'CASH', totalCommission: 23 }),
      makeTx({ branch: 'Chulia', businessDate: D, staff: 'Pim', method: 'Freelance', totalCommission: 50 }),
    ]
    const result = payoutReport(rows, roster, cycle)
    expect(result.Kimberry).toEqual([{ staff: 'Beer', total: 23 }])
    expect(result.Bishop).toEqual([])
    expect(result.Chulia).toEqual([])
  })

  it('uses the roster display name when the row staff matches case-insensitively', () => {
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'beer', method: 'CASH', totalCommission: 23 }),
    ]
    const result = payoutReport(rows, roster, cycle)
    // Roster has 'Beer'; the lowercase 'beer' on the row should display as 'Beer'.
    expect(result.Kimberry).toEqual([{ staff: 'Beer', total: 23 }])
  })

  it('falls back to the row staff name when the roster has no match', () => {
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'NewHire', method: 'CASH', totalCommission: 10 }),
    ]
    const result = payoutReport(rows, roster, cycle)
    expect(result.Kimberry).toEqual([{ staff: 'NewHire', total: 10 }])
  })

  it('sorts each branch slice by total descending, ties by staff name ascending', () => {
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Charlie', method: 'CASH', totalCommission: 50 }),
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Alice', method: 'CASH', totalCommission: 50 }),
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Bob', method: 'CASH', totalCommission: 80 }),
    ]
    const result = payoutReport(rows, roster, cycle)
    expect(result.Kimberry).toEqual([
      { staff: 'Bob', total: 80 },
      { staff: 'Alice', total: 50 },
      { staff: 'Charlie', total: 50 },
    ])
  })

  it('ignores rows outside the cycle', () => {
    const rows: TransactionRow[] = [
      makeTx({ branch: 'Kimberry', businessDate: D, staff: 'Beer', method: 'CASH', totalCommission: 23 }),
      makeTx({ branch: 'Kimberry', businessDate: '2026-05-21', staff: 'Beer', method: 'CASH', totalCommission: 999 }),
    ]
    const result = payoutReport(rows, roster, cycle)
    expect(result.Kimberry).toEqual([{ staff: 'Beer', total: 23 }])
  })
})
