/**
 * heals-system-rebuild — End-to-end domain flow test.
 *
 * Exercises the data-flow that backs a single working day at a real
 * branch, end-to-end, in a single test:
 *
 *   1. Cashier writes a CASH session with the Customer Balm flag —
 *      `customerPriceWithFlags` adds RM 10 to the price; the price
 *      table contains FR/60/Kimberry = 70 → final price 80.
 *   2. `computeCommission` picks the Staff Balm bonus (+3) and
 *      Booking bonus for 60min (+3) and the regular FR/60 rate (23).
 *   3. The row appears in `buildCanonicalView`, attributed to
 *      Kimberry.
 *   4. `buildSalaryBoard` lists the staff in the Kimberry per-branch
 *      section with the right totals.
 *   5. `computeDayBranchIncome` reports sales=80, cash=80, qr=0,
 *      collected=80, sessions=1, expenses=0, netIncome=80.
 *   6. A second EXTRA row at Kimberry destined for Bishop with no
 *      matching real row at Bishop falls back to Bishop on the
 *      salary board (canonical view rule).
 *   7. The queue board sees both staff and orders them: the one with
 *      zero today-earnings goes first.
 *
 * No Supabase, no mocks for the DB — pure domain math against the
 * actual price + rate tables produced by the seed shape. If the
 * domain math drifts, this test catches it.
 */

import { computeDayBranchIncome } from '@/domain/income-board'
import {
  buildCanonicalView,
  buildSalaryBoard,
} from '@/domain/salary-board'
import {
  computeCommission,
  customerPriceWithFlags,
  priceTableFromRows,
  type FreelanceRateRow,
  type PriceRow,
  type RegularRateRow,
} from '@/domain/commission'
import { buildQueue } from '@/domain/queue'
import { cycleDates } from '@/domain/cycle'
import {
  BRANCHES,
  type Branch,
  type StaffMember,
  type TransactionRow,
} from '@/domain/types'

// ---------------------------------------------------------------------------
// Fixture: realistic price + rate tables (subset of the seeds)
// ---------------------------------------------------------------------------

const priceRows: PriceRow[] = [
  { course: 'FR', duration: 60, branch: 'Kimberry', price: 70 },
  { course: 'FR', duration: 60, branch: 'Bishop', price: 68 }, // -2 RM rule
  { course: 'FR', duration: 60, branch: 'Chulia', price: 70 },
  { course: 'FR', duration: 90, branch: 'Kimberry', price: 100 },
  { course: 'FR', duration: 90, branch: 'Bishop', price: 98 },
  { course: 'FR', duration: 90, branch: 'Chulia', price: 100 },
]
const priceTable = priceTableFromRows(priceRows)

const regularRates: RegularRateRow[] = [
  {
    course: 'FR',
    duration: 60,
    branchGroup: 'all',
    amount: 23,
    effectiveFrom: '2026-01-01',
  },
  {
    course: 'FR',
    duration: 90,
    branchGroup: 'all',
    amount: 31,
    effectiveFrom: '2026-01-01',
  },
]
const freelanceRates: FreelanceRateRow[] = [
  {
    course: 'FR',
    duration: 60,
    branchGroup: 'all',
    amount: 35,
    effectiveFrom: '2026-01-01',
  },
]

const roster: StaffMember[] = [
  {
    id: 's1',
    name: 'Beer',
    homeBranch: 'Kimberry',
    isFreelance: false,
    isActive: true,
  },
  {
    id: 's2',
    name: 'Aom',
    homeBranch: 'Kimberry',
    isFreelance: false,
    isActive: true,
  },
]

const D = '2026-05-15'

function makeRow(overrides: Partial<TransactionRow> & {
  cashierRowNumber: number
  staff: string
  branch: Branch
}): TransactionRow {
  return {
    id: `${overrides.branch}-${overrides.cashierRowNumber}`,
    businessDate: D,
    course: 'FR',
    duration: 60,
    timeIn: null,
    timeOut: null,
    method: 'CASH',
    addon: 0,
    baseCommission: 0,
    balmBonus: 0,
    bookingBonus: 0,
    totalCommission: 0,
    cash: 0,
    qr: 0,
    credit: 0,
    price: 0,
    flags: '',
    comment: '',
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    ...overrides,
  }
}

describe('heals end-to-end domain flow', () => {
  it('1. Customer Balm flag adds RM 10 to FR/60/Kimberry (70 → 80)', () => {
    const price = customerPriceWithFlags(
      'FR',
      60,
      'Kimberry',
      'CASH',
      'Customer Balm',
      priceTable,
    )
    expect(price).toBe(80)
  })

  it('2. computeCommission: FR/60 with Staff Balm + Booking + addon 0 → total 29', () => {
    const result = computeCommission({
      course: 'FR',
      duration: 60,
      branch: 'Kimberry',
      businessDate: D,
      method: 'CASH',
      staffBalm: true,
      booking: true,
      addon: 0,
      regularRates,
      freelanceRates,
      priceTable,
    })
    // base (23) + balm (3) + book (3) + addon (0) = 29
    expect(result.base).toBe(23)
    expect(result.balm).toBe(3)
    expect(result.book).toBe(3)
    expect(result.total).toBe(29)
  })

  it('3. Canonical view places real Kimberry CASH row at Kimberry', () => {
    const rows: TransactionRow[] = [
      makeRow({
        cashierRowNumber: 1,
        staff: 'Beer',
        branch: 'Kimberry',
        method: 'CASH',
        cash: 80,
        price: 80,
        baseCommission: 23,
        balmBonus: 3,
        bookingBonus: 3,
        totalCommission: 29,
        flags: 'Staff Balm,Customer Balm,Booking',
      }),
    ]
    const view = buildCanonicalView(rows)
    expect(view).toHaveLength(1)
    expect(view[0].branch).toBe('Kimberry')
    expect(view[0].staffLc).toBe('beer')
    expect(view[0].total).toBe(29)
    expect(view[0].isFallbackExtra).toBe(false)
  })

  it('4. buildSalaryBoard renders Kimberry section with one staff row', () => {
    const cycle = cycleDates(4, 2026, 21)
    const rows: TransactionRow[] = [
      makeRow({
        cashierRowNumber: 1,
        staff: 'Beer',
        branch: 'Kimberry',
        method: 'CASH',
        cash: 80,
        price: 80,
        totalCommission: 29,
      }),
    ]
    const board = buildSalaryBoard(rows, roster, cycle)
    expect(board.perBranch.Kimberry).toBeDefined()
    expect(board.perBranch.Kimberry?.staff).toHaveLength(1)
    expect(board.perBranch.Kimberry?.staff[0].name).toBe('Beer')
    expect(board.perBranch.Kimberry?.staff[0].total).toBe(29)
    // Bishop / Chulia have no eligible staff with non-zero totals →
    // omitted entirely (Req 9.1 strict).
    expect(board.perBranch.Bishop).toBeUndefined()
    expect(board.perBranch.Chulia).toBeUndefined()
  })

  it('5. computeDayBranchIncome reports sales 80, cash 80, net 80', () => {
    const rows: TransactionRow[] = [
      makeRow({
        cashierRowNumber: 1,
        staff: 'Beer',
        branch: 'Kimberry',
        method: 'CASH',
        cash: 80,
        price: 80,
      }),
    ]
    const income = computeDayBranchIncome(rows, [], 'Kimberry', D)
    expect(income.sales).toBe(80)
    expect(income.cash).toBe(80)
    expect(income.qr).toBe(0)
    expect(income.credit).toBe(0)
    expect(income.collected).toBe(80)
    expect(income.sessions).toBe(1)
    expect(income.expenses).toBe(0)
    expect(income.netIncome).toBe(80)
  })

  it('6. EXTRA Kimberry → Bishop with no real row at Bishop falls back to Bishop', () => {
    const cycle = cycleDates(4, 2026, 21)
    const rows: TransactionRow[] = [
      makeRow({
        cashierRowNumber: 1,
        staff: 'Beer',
        branch: 'Kimberry',
        method: 'CASH',
        cash: 80,
        price: 80,
        totalCommission: 23,
      }),
      makeRow({
        cashierRowNumber: 2,
        staff: 'Beer',
        branch: 'Kimberry',
        course: 'FR',
        duration: 90,
        method: 'EXTRA BS',
        totalCommission: 31,
      }),
    ]
    const view = buildCanonicalView(rows)
    expect(view).toHaveLength(2)
    const fallback = view.find((e) => e.isFallbackExtra)
    expect(fallback).toBeDefined()
    expect(fallback?.branch).toBe('Bishop')
    expect(fallback?.total).toBe(31)

    const board = buildSalaryBoard(rows, roster, cycle)
    // Beer should appear in Kimberry (real row) AND Bishop (fallback).
    expect(board.perBranch.Kimberry?.staff[0].total).toBe(23)
    expect(board.perBranch.Bishop?.staff[0].name).toBe('Beer')
    expect(board.perBranch.Bishop?.staff[0].total).toBe(31)
    // Multi-branch summary picks Beer up since they earned at ≥2 branches.
    expect(board.multiBranch.staff).toHaveLength(1)
    expect(board.multiBranch.staff[0].name).toBe('Beer')
    expect(board.multiBranch.staff[0].total).toBe(54)
  })

  it('7. Queue: zero-earnings staff goes first, earner goes second', () => {
    const todayRows = [
      {
        staff: 'Beer',
        branch: 'Kimberry' as Branch,
        businessDate: D,
        method: 'CASH',
        commission: 29,
        timeIn: '10:00',
        timeOut: '11:00',
        duration: 60,
      },
    ]
    // Aom hasn't earned anything yet. Beer has earned 29.
    const queue = buildQueue({
      branch: 'Kimberry',
      businessDate: D,
      todayRows,
      yesterdayRows: [],
      todayRoster: ['Beer', 'Aom'],
      // Use a time AFTER Beer's session ends so neither is "busy".
      nowKL: '12:00',
    })
    expect(queue).toHaveLength(2)
    // Aom (zero earnings, isNew) sorts first.
    expect(queue[0].staff).toBe('Aom')
    expect(queue[0].isNew).toBe(true)
    expect(queue[0].position).toBe(1)
    // Beer sorts second.
    expect(queue[1].staff).toBe('Beer')
    expect(queue[1].isNew).toBe(false)
    expect(queue[1].position).toBe(2)
  })

  it('8. Tie-break: same today-earnings → lower yesterday-earnings goes first', () => {
    const todayRows = [
      {
        staff: 'Beer',
        branch: 'Kimberry' as Branch,
        businessDate: D,
        method: 'CASH',
        commission: 50,
        timeIn: '10:00',
        timeOut: '11:00',
        duration: 60,
      },
      {
        staff: 'Aom',
        branch: 'Kimberry' as Branch,
        businessDate: D,
        method: 'CASH',
        commission: 50,
        timeIn: '11:00',
        timeOut: '12:00',
        duration: 60,
      },
    ]
    const yesterdayRows = [
      {
        staff: 'Beer',
        branch: 'Kimberry' as Branch,
        businessDate: '2026-05-14',
        method: 'CASH',
        commission: 100,
        timeIn: '10:00',
        timeOut: '11:00',
        duration: 60,
      },
      {
        staff: 'Aom',
        branch: 'Kimberry' as Branch,
        businessDate: '2026-05-14',
        method: 'CASH',
        commission: 30,
        timeIn: '10:00',
        timeOut: '11:00',
        duration: 60,
      },
    ]
    const queue = buildQueue({
      branch: 'Kimberry',
      businessDate: D,
      todayRows,
      yesterdayRows,
      todayRoster: ['Beer', 'Aom'],
      nowKL: '14:00',
    })
    // Both earned 50 today. Beer earned 100 yesterday, Aom earned 30.
    // Aom (lower yesterday) goes higher today by the swap rule.
    expect(queue[0].staff).toBe('Aom')
    expect(queue[1].staff).toBe('Beer')
  })

  it('9. EXTRA covered by real row at destination → EXTRA dropped from canonical view', () => {
    const rows: TransactionRow[] = [
      makeRow({
        cashierRowNumber: 1,
        staff: 'Beer',
        branch: 'Kimberry',
        course: 'FR',
        duration: 60,
        method: 'EXTRA BS',
        totalCommission: 23,
      }),
      makeRow({
        cashierRowNumber: 1,
        staff: 'Beer',
        branch: 'Bishop',
        course: 'FR',
        duration: 60,
        method: 'CASH',
        cash: 68,
        price: 68,
        totalCommission: 23,
      }),
    ]
    const view = buildCanonicalView(rows)
    // Real Bishop row counts; EXTRA at Kimberry is dropped (covered).
    expect(view).toHaveLength(1)
    expect(view[0].branch).toBe('Bishop')
    expect(view[0].isFallbackExtra).toBe(false)
  })

  it('10. Customer Balm + EXTRA → price still zero (EXTRA short-circuits)', () => {
    const price = customerPriceWithFlags(
      'FR',
      60,
      'Kimberry',
      'EXTRA BS',
      'Customer Balm',
      priceTable,
    )
    expect(price).toBe(0)
  })
})

describe('Branches enum is consistent across modules', () => {
  it('exports the same three branch codes everywhere', () => {
    expect([...BRANCHES]).toEqual(['Kimberry', 'Bishop', 'Chulia'])
  })
})
