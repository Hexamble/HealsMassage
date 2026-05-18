/**
 * Unit + property tests for `salary-board.ts` (heals contract).
 *
 * Validates:
 *   - Requirements 5.2, 5.3, 5.4, 5.5, 5.6 (EXTRA attribution)
 *   - Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.7 (Salary Board)
 *   - Requirement 18.2 (Freelance excluded from salary board)
 *   - Property 4 — Canonical view never double-counts
 *   - Property 6 — Salary board home-branch attribution + freelance exclusion
 *   - Property 9 — Cycle payout total equals sum of daily totals
 *
 * Source-of-truth references:
 *   - `c:/BILL/.kiro/specs/heals-system-rebuild/design.md` §EXTRA Attribution
 *   - `c:/BILL/.kiro/specs/heals-system-rebuild/requirements.md` §9, §5, §18
 *   - `c:/BILL/tests/salaryExtraFallback.test.js` (May 15 2026 fixture origin)
 */

import fc from 'fast-check'
import {
  aggregateByStaff,
  buildCanonicalView,
  buildSalaryBoard,
  resolveHomeBranch,
} from './salary-board'
import {
  BRANCHES,
  COURSES,
  DURATIONS,
  type Branch,
  type Course,
  type Cycle,
  type Duration,
  type StaffMember,
  type TransactionRow,
} from './types'
import { cycleDates } from './cycle'
import {
  buildExtraMatchKey,
  decodeExtraDestination,
  isExtraMethod,
} from './extra'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface RowSpec {
  branch: Branch
  businessDate: string
  cashierRowNumber: number
  staff: string
  course: Course
  duration: Duration
  method: string
  totalCommission: number
  price?: number
  cash?: number
  qr?: number
  credit?: number
}

function row(spec: RowSpec): TransactionRow {
  return {
    id: `${spec.branch}|${spec.businessDate}|${spec.cashierRowNumber}`,
    branch: spec.branch,
    businessDate: spec.businessDate,
    cashierRowNumber: spec.cashierRowNumber,
    staff: spec.staff,
    course: spec.course,
    duration: spec.duration,
    timeIn: null,
    timeOut: null,
    method: spec.method,
    addon: 0,
    baseCommission: spec.totalCommission,
    balmBonus: 0,
    bookingBonus: 0,
    totalCommission: spec.totalCommission,
    cash: spec.cash ?? 0,
    qr: spec.qr ?? 0,
    credit: spec.credit ?? 0,
    price: spec.price ?? 0,
    flags: '',
    comment: '',
    createdAt: '',
    updatedAt: '',
    createdBy: null,
  }
}

function staff(
  name: string,
  homeBranch: Branch,
  opts: { isFreelance?: boolean; isActive?: boolean } = {},
): StaffMember {
  return {
    id: `staff-${name.toLowerCase()}`,
    name,
    homeBranch,
    isFreelance: opts.isFreelance ?? false,
    isActive: opts.isActive ?? true,
  }
}

// ---------------------------------------------------------------------------
// May 15, 2026 gold-standard fixture (heals shape)
// ---------------------------------------------------------------------------

const MAY15 = '2026-05-15'

let __seq = 0
const nextSeq = () => ++__seq

function kim(spec: Omit<RowSpec, 'branch' | 'businessDate' | 'cashierRowNumber'>): TransactionRow {
  return row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: nextSeq(), ...spec })
}
function bishop(spec: Omit<RowSpec, 'branch' | 'businessDate' | 'cashierRowNumber'>): TransactionRow {
  return row({ branch: 'Bishop', businessDate: MAY15, cashierRowNumber: nextSeq(), ...spec })
}

const may15Rows: TransactionRow[] = [
  // Kimberry real
  kim({ staff: 'Ney',  course: 'DTM', duration: 60, method: 'CREDIT', price:  98, credit:  98, totalCommission: 31 }),
  kim({ staff: 'Beer', course: 'FR',  duration: 60, method: 'CASH',   price:  70, cash:    70, totalCommission: 23 }),
  kim({ staff: 'Nana', course: 'DTM', duration: 60, method: 'CREDIT', price:  98, credit:  98, totalCommission: 31 }),
  kim({ staff: 'Lin',  course: 'FNS', duration: 60, method: 'CREDIT', price:  80, credit:  80, totalCommission: 26 }),
  kim({ staff: 'Nan',  course: 'DTM', duration: 60, method: 'CREDIT', price:  98, credit:  98, totalCommission: 31 }),
  kim({ staff: 'Pra',  course: 'DTM', duration: 60, method: 'CREDIT', price:  98, credit:  98, totalCommission: 31 }),
  kim({ staff: 'Ney',  course: 'FR',  duration: 90, method: 'QR',     price: 100, qr:     100, totalCommission: 31 }),
  kim({ staff: 'Beer', course: 'FR',  duration: 90, method: 'QR',     price: 100, qr:     100, totalCommission: 31 }),
  // EXTRA → Bishop (covered by Bishop real rows below)
  kim({ staff: 'Nana', course: 'FR',  duration: 60, method: 'EXTRA BS', totalCommission: 23 }),
  kim({ staff: 'Lin',  course: 'FR',  duration: 60, method: 'EXTRA BS', totalCommission: 23 }),
  kim({ staff: 'Nan',  course: 'FR',  duration: 60, method: 'EXTRA BS', totalCommission: 23 }),
  kim({ staff: 'Pra',  course: 'FR',  duration: 60, method: 'EXTRA BS', totalCommission: 23 }),
  kim({ staff: 'Ney',  course: 'HOM', duration: 60, method: 'EXTRA BS', totalCommission: 34 }),
  // EXTRA → Chulia (uncovered — Chulia logs nothing this day)
  kim({ staff: 'Beer', course: 'FR',  duration: 90, method: 'EXTRA CL', totalCommission: 31 }),
  kim({ staff: 'Nana', course: 'FNS', duration: 90, method: 'EXTRA CL', totalCommission: 35 }),
  kim({ staff: 'Lin',  course: 'FNS', duration: 90, method: 'EXTRA CL', totalCommission: 35 }),
  kim({ staff: 'Nan',  course: 'BMT', duration: 60, method: 'EXTRA CL', totalCommission: 26 }),
  kim({ staff: 'Beer', course: 'BMT', duration: 60, method: 'EXTRA CL', totalCommission: 26 }),
  // Bishop real (covers EXTRA BS above)
  bishop({ staff: 'Nana', course: 'FR',  duration: 60, method: 'CREDIT', price:  68, credit:  68, totalCommission: 23 }),
  bishop({ staff: 'Lin',  course: 'FR',  duration: 60, method: 'CREDIT', price:  68, credit:  68, totalCommission: 23 }),
  bishop({ staff: 'Yui',  course: 'FR',  duration: 60, method: 'CREDIT', price:  68, credit:  68, totalCommission: 23 }),
  bishop({ staff: 'Nan',  course: 'FR',  duration: 60, method: 'CASH',   price:  68, cash:    68, totalCommission: 23 }),
  bishop({ staff: 'Pra',  course: 'FR',  duration: 60, method: 'QR',     price:  68, qr:     68, totalCommission: 23 }),
  bishop({ staff: 'Ney',  course: 'HOM', duration: 60, method: 'CREDIT', price: 115, credit: 115, totalCommission: 34 }),
]

const may15Roster: StaffMember[] = [
  staff('Beer', 'Kimberry'),
  staff('Ney',  'Kimberry'),
  staff('Nana', 'Kimberry'),
  staff('Lin',  'Kimberry'),
  staff('Nan',  'Kimberry'),
  staff('Pra',  'Kimberry'),
  staff('Yui',  'Bishop'),
]

const mayCycle = cycleDates(4, 2026, 21)

// ---------------------------------------------------------------------------
// buildCanonicalView — unit tests
// ---------------------------------------------------------------------------

describe('buildCanonicalView', () => {
  it('drops Freelance rows entirely', () => {
    const rows = [
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 1, staff: 'Free1', course: 'FR', duration: 60, method: 'Freelance', totalCommission: 0, price: 70, cash: 70 }),
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 2, staff: 'Beer', course: 'FR', duration: 60, method: 'CASH', totalCommission: 23, price: 70, cash: 70 }),
    ]
    const out = buildCanonicalView(rows)
    expect(out).toHaveLength(1)
    expect(out[0].staffLc).toBe('beer')
    expect(out[0].branch).toBe('Kimberry')
    expect(out[0].total).toBe(23)
    expect(out[0].isFallbackExtra).toBe(false)
  })

  it('keeps real rows at their own branch', () => {
    const rows = [
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 1, staff: 'Beer', course: 'FR', duration: 60, method: 'CASH', totalCommission: 23 }),
      row({ branch: 'Bishop',   businessDate: MAY15, cashierRowNumber: 2, staff: 'Yui',  course: 'FR', duration: 60, method: 'QR',   totalCommission: 23 }),
    ]
    const out = buildCanonicalView(rows)
    expect(out.map((e) => `${e.staffLc}|${e.branch}|${e.total}`)).toEqual([
      'beer|Kimberry|23',
      'yui|Bishop|23',
    ])
  })

  it('drops a covered EXTRA (matching real row at destination)', () => {
    const rows = [
      // Real Bishop row covers Nana FR 60 at Bishop
      row({ branch: 'Bishop',   businessDate: MAY15, cashierRowNumber: 1, staff: 'Nana', course: 'FR', duration: 60, method: 'CREDIT',   totalCommission: 23 }),
      // EXTRA logged at Kimberry destined for Bishop
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 2, staff: 'Nana', course: 'FR', duration: 60, method: 'EXTRA BS', totalCommission: 23 }),
    ]
    const out = buildCanonicalView(rows)
    expect(out).toHaveLength(1)
    expect(out[0].branch).toBe('Bishop')
    expect(out[0].total).toBe(23)
    expect(out[0].isFallbackExtra).toBe(false)
  })

  it('falls back an uncovered EXTRA to the decoded destination branch', () => {
    const rows = [
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 1, staff: 'Beer', course: 'FR', duration: 90, method: 'EXTRA CL', totalCommission: 31 }),
    ]
    const out = buildCanonicalView(rows)
    expect(out).toHaveLength(1)
    expect(out[0].branch).toBe('Chulia')
    expect(out[0].total).toBe(31)
    expect(out[0].isFallbackExtra).toBe(true)
  })

  it('drops EXTRA rows whose destination cannot be decoded', () => {
    const rows = [
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 1, staff: 'Beer', course: 'FR', duration: 60, method: 'EXTRA QQ', totalCommission: 23 }),
    ]
    expect(buildCanonicalView(rows)).toEqual([])
  })

  it('reproduces May 15 2026 per-staff totals (cross-branch sum)', () => {
    const out = buildCanonicalView(may15Rows)
    const totals: Record<string, number> = {}
    for (const e of out) {
      totals[e.staffLc] = (totals[e.staffLc] ?? 0) + e.total
    }
    expect(totals).toEqual({
      beer: 111, // 23 + 31 + 31 + 26
      ney:   96, // 31 + 31 + 34 (EXTRA BS covered → Bishop credit)
      nana:  89, // 31 + 23 (Bishop) + 35 (Chulia fallback)
      lin:   84, // 26 + 23 (Bishop) + 35 (Chulia fallback)
      nan:   80, // 31 + 23 (Bishop) + 26 (Chulia fallback)
      pra:   54, // 31 + 23 (Bishop)
      yui:   23, // 23 (Bishop only)
    })
  })

  it('matches a real row case-insensitively on staff/course and tolerant of duration as string', () => {
    // Cashiers can type the EXTRA row with different casing/whitespace —
    // this MUST still match the real row at the destination.
    const rows = [
      row({ branch: 'Bishop',   businessDate: MAY15, cashierRowNumber: 1, staff: '  nana  ', course: 'fr' as Course, duration: 60, method: 'CREDIT',     totalCommission: 23 }),
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 2, staff: 'NANA',     course: 'FR',            duration: 60, method: 'extra bs',  totalCommission: 23 }),
    ]
    const out = buildCanonicalView(rows)
    expect(out).toHaveLength(1) // EXTRA covered
    expect(out[0].branch).toBe('Bishop')
  })
})

// ---------------------------------------------------------------------------
// aggregateByStaff
// ---------------------------------------------------------------------------

describe('aggregateByStaff', () => {
  it('sums entries per (staffLc, branch, date)', () => {
    const canonical = buildCanonicalView(may15Rows)
    const agg = aggregateByStaff(canonical)

    const find = (staffLc: string, branch: Branch, date: string) =>
      agg.find((a) => a.staffLc === staffLc && a.branch === branch && a.date === date)

    expect(find('beer', 'Kimberry', MAY15)?.total).toBe(54) // 23 + 31
    expect(find('beer', 'Chulia', MAY15)?.total).toBe(57)   // 31 + 26 (fallback)
    expect(find('yui',  'Bishop',  MAY15)?.total).toBe(23)
    // Beer never has Bishop entries on May 15 — the EXTRA BS rows don't include him.
    expect(find('beer', 'Bishop',  MAY15)).toBeUndefined()
  })

  it('preserves first-seen display casing per staff', () => {
    const rows = [
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 1, staff: 'BEER', course: 'FR', duration: 60, method: 'CASH', totalCommission: 23 }),
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 2, staff: 'beer', course: 'FR', duration: 90, method: 'QR',   totalCommission: 31 }),
    ]
    const agg = aggregateByStaff(buildCanonicalView(rows))
    expect(agg).toHaveLength(1)
    expect(agg[0].staffDisplay).toBe('BEER')
    expect(agg[0].total).toBe(54)
  })
})

// ---------------------------------------------------------------------------
// resolveHomeBranch
// ---------------------------------------------------------------------------

describe('resolveHomeBranch', () => {
  const roster: StaffMember[] = [
    staff('Beer', 'Kimberry'),
    staff('Yui',  'Bishop'),
    staff('Old',  'Chulia', { isActive: false }),
  ]

  it('matches case-insensitively after trimming', () => {
    expect(resolveHomeBranch('  beer  ', roster)).toBe('Kimberry')
    expect(resolveHomeBranch('YUI', roster)).toBe('Bishop')
  })

  it('returns null for inactive staff', () => {
    expect(resolveHomeBranch('Old', roster)).toBeNull()
  })

  it('returns null when no roster match', () => {
    expect(resolveHomeBranch('NotInRoster', roster)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// buildSalaryBoard — May 15 fixture
// ---------------------------------------------------------------------------

describe('buildSalaryBoard (May 15 2026 gold-standard)', () => {
  const board = buildSalaryBoard(may15Rows, may15Roster, mayCycle)

  it('Kimberry section lists all 6 Kimberry-home staff with correct totals', () => {
    const k = board.perBranch.Kimberry
    expect(k).toBeDefined()
    const byName = new Map(k!.staff.map((r) => [r.name, r.total]))
    expect(byName.get('Beer')).toBe(54)  // 23 + 31 (real Kim only, EXTRA CL fallback shows in Chulia)
    expect(byName.get('Ney')).toBe(62)   // 31 + 31 (real Kim; HOM EXTRA covered → Bishop)
    expect(byName.get('Nana')).toBe(31)  // Kim DTM only (FR EXTRA covered → Bishop, FNS EXTRA fallback → Chulia)
    expect(byName.get('Lin')).toBe(26)   // Kim FNS (others fall to Bishop covered / Chulia fallback)
    expect(byName.get('Nan')).toBe(31)   // Kim DTM
    expect(byName.get('Pra')).toBe(31)   // Kim DTM
  })

  it('Bishop section includes Yui plus everyone with covered-EXTRA Bishop attribution', () => {
    const b = board.perBranch.Bishop
    expect(b).toBeDefined()
    const byName = new Map(b!.staff.map((r) => [r.name, r.total]))
    expect(byName.get('Yui')).toBe(23)
    expect(byName.get('Nana')).toBe(23)
    expect(byName.get('Lin')).toBe(23)
    expect(byName.get('Nan')).toBe(23)
    expect(byName.get('Pra')).toBe(23)
    expect(byName.get('Ney')).toBe(34)
  })

  it('Chulia section lists staff whose uncovered EXTRA fell back to Chulia', () => {
    const c = board.perBranch.Chulia
    expect(c).toBeDefined()
    const byName = new Map(c!.staff.map((r) => [r.name, r.total]))
    expect(byName.get('Beer')).toBe(57)  // 31 + 26
    expect(byName.get('Nana')).toBe(35)
    expect(byName.get('Lin')).toBe(35)
    expect(byName.get('Nan')).toBe(26)
  })

  it('multi-branch summary lists every staff at ≥2 distinct branches', () => {
    const names = board.multiBranch.staff.map((r) => r.name).sort()
    // Yui only has Bishop → excluded.
    expect(names).toEqual(['Beer', 'Lin', 'Nan', 'Nana', 'Ney', 'Pra'])
  })

  it('each section total equals the sum of its staff totals', () => {
    for (const branch of BRANCHES) {
      const sec = board.perBranch[branch]
      if (!sec) continue
      const sum = sec.staff.reduce((s, r) => s + r.total, 0)
      expect(sec.total).toBe(sum)
    }
    const mbSum = board.multiBranch.staff.reduce((s, r) => s + r.total, 0)
    expect(board.multiBranch.total).toBe(mbSum)
  })

  it("each staff row's total equals the sum of their daily values", () => {
    const allRows = [
      ...(board.perBranch.Kimberry?.staff ?? []),
      ...(board.perBranch.Bishop?.staff ?? []),
      ...(board.perBranch.Chulia?.staff ?? []),
      ...board.multiBranch.staff,
    ]
    for (const r of allRows) {
      const sum = Object.values(r.daily).reduce((s, v) => s + v, 0)
      expect(r.total).toBe(sum)
    }
  })

  it('staff in each section are sorted by total desc, ties broken by name asc', () => {
    for (const branch of BRANCHES) {
      const sec = board.perBranch[branch]
      if (!sec) continue
      for (let i = 1; i < sec.staff.length; i++) {
        const a = sec.staff[i - 1]
        const b = sec.staff[i]
        if (a.total === b.total) expect(a.name.localeCompare(b.name)).toBeLessThanOrEqual(0)
        else expect(a.total).toBeGreaterThanOrEqual(b.total)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// buildSalaryBoard — Req 9.1 (omit empty branch sections) and freelance exclusion
// ---------------------------------------------------------------------------

describe('buildSalaryBoard (omission and exclusion)', () => {
  it('omits a per-branch section entirely when no eligible staff has data there', () => {
    // Only Kimberry has data; Bishop/Chulia have no rows at all.
    const rows = [
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 1, staff: 'Beer', course: 'FR', duration: 60, method: 'CASH', totalCommission: 23 }),
    ]
    const roster: StaffMember[] = [staff('Beer', 'Kimberry')]
    const board = buildSalaryBoard(rows, roster, mayCycle)
    expect(Object.prototype.hasOwnProperty.call(board.perBranch, 'Kimberry')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(board.perBranch, 'Bishop')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(board.perBranch, 'Chulia')).toBe(false)
  })

  it('excludes freelance roster members from per-branch and multi-branch sections', () => {
    const rows = [
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 1, staff: 'FreelancerName', course: 'FR', duration: 60, method: 'CASH', totalCommission: 25 }),
      row({ branch: 'Bishop',   businessDate: MAY15, cashierRowNumber: 2, staff: 'FreelancerName', course: 'FR', duration: 60, method: 'CASH', totalCommission: 25 }),
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 3, staff: 'Beer',           course: 'FR', duration: 60, method: 'CASH', totalCommission: 23 }),
    ]
    const roster: StaffMember[] = [
      staff('FreelancerName', 'Kimberry', { isFreelance: true }),
      staff('Beer', 'Kimberry'),
    ]
    const board = buildSalaryBoard(rows, roster, mayCycle)
    const allNames = new Set([
      ...(board.perBranch.Kimberry?.staff.map((r) => r.name) ?? []),
      ...(board.perBranch.Bishop?.staff.map((r) => r.name) ?? []),
      ...(board.perBranch.Chulia?.staff.map((r) => r.name) ?? []),
      ...board.multiBranch.staff.map((r) => r.name),
    ])
    expect(allNames.has('FreelancerName')).toBe(false)
    expect(allNames.has('Beer')).toBe(true)
  })

  it('drops Freelance method rows even when staff name matches a non-freelance roster member', () => {
    const rows = [
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 1, staff: 'Beer', course: 'FR', duration: 60, method: 'Freelance', totalCommission: 99, price: 70, cash: 70 }),
      row({ branch: 'Kimberry', businessDate: MAY15, cashierRowNumber: 2, staff: 'Beer', course: 'FR', duration: 60, method: 'CASH',      totalCommission: 23 }),
    ]
    const roster: StaffMember[] = [staff('Beer', 'Kimberry')]
    const board = buildSalaryBoard(rows, roster, mayCycle)
    expect(board.perBranch.Kimberry?.staff[0].total).toBe(23)
  })

  it('filters rows outside the cycle window', () => {
    const offCycleDate = '2026-05-25' // mayCycle ends 2026-05-20
    const rows = [
      row({ branch: 'Kimberry', businessDate: MAY15,         cashierRowNumber: 1, staff: 'Beer', course: 'FR', duration: 60, method: 'CASH', totalCommission: 23 }),
      row({ branch: 'Kimberry', businessDate: offCycleDate,  cashierRowNumber: 2, staff: 'Beer', course: 'FR', duration: 60, method: 'CASH', totalCommission: 99 }),
    ]
    const roster: StaffMember[] = [staff('Beer', 'Kimberry')]
    const board = buildSalaryBoard(rows, roster, mayCycle)
    expect(board.perBranch.Kimberry?.staff[0].total).toBe(23)
  })
})

// ---------------------------------------------------------------------------
// Property generators
// ---------------------------------------------------------------------------

const arbBranch = fc.constantFrom<Branch[]>(...(BRANCHES as readonly Branch[]).slice() as Branch[])
const arbStaff = fc.constantFrom('beer', 'ney', 'nana', 'lin', 'nan', 'pra')
const arbCourse = fc.constantFrom<Course[]>(...(COURSES as readonly Course[]).slice() as Course[])
const arbDuration = fc.constantFrom<Duration[]>(...(DURATIONS as readonly Duration[]).slice() as Duration[])
const arbDate = fc.constantFrom('2026-05-14', '2026-05-15', '2026-05-16')
const arbCommission = fc.integer({ min: 1, max: 100 })

const arbMethod = fc.oneof(
  { weight: 7, arbitrary: fc.constantFrom('CASH', 'QR', 'CREDIT', 'Freelance') },
  { weight: 3, arbitrary: fc.constantFrom('EXTRA KM', 'EXTRA BS', 'EXTRA CL') },
)

function buildArb(methodArb: fc.Arbitrary<string>): fc.Arbitrary<TransactionRow> {
  return fc
    .record({
      branch: arbBranch,
      businessDate: arbDate,
      cashierRowNumber: fc.integer({ min: 1, max: 9999 }),
      staff: arbStaff,
      course: arbCourse,
      duration: arbDuration,
      method: methodArb,
      totalCommission: arbCommission,
    })
    .map((r): TransactionRow => row({
      branch: r.branch,
      businessDate: r.businessDate,
      cashierRowNumber: r.cashierRowNumber,
      staff: r.staff,
      course: r.course,
      duration: r.duration,
      method: r.method,
      totalCommission: r.totalCommission,
    }))
}

const arbRow = buildArb(arbMethod)

// ---------------------------------------------------------------------------
// Property: canonical view never double-counts
//
// Independently compute the expected per-(staff, day) sum and compare
// against the canonical view sum across all attribution branches.
// ---------------------------------------------------------------------------
describe('Property: canonical view never double-counts', () => {
  it('canonical sum across branches per (staff, day) equals the canonical-projection sum', () => {
    fc.assert(
      fc.property(fc.array(arbRow, { minLength: 0, maxLength: 12 }), (rows) => {
        // Independent canonical-projection computation.
        const realKeys = new Set<string>()
        for (const r of rows) {
          if (String(r.method).toLowerCase() === 'freelance') continue
          if (decodeExtraDestination(r.method) !== null) continue
          realKeys.add(buildExtraMatchKey({
            staff: r.staff,
            businessDate: r.businessDate,
            course: r.course,
            duration: r.duration,
            branch: r.branch,
          }))
        }
        const expected: Record<string, number> = {}
        for (const r of rows) {
          if (String(r.method).toLowerCase() === 'freelance') continue
          const dest = decodeExtraDestination(r.method)
          if (dest !== null) {
            const k = buildExtraMatchKey({
              staff: r.staff,
              businessDate: r.businessDate,
              course: r.course,
              duration: r.duration,
              branch: dest,
            })
            if (realKeys.has(k)) continue
          } else if (isExtraMethod(r.method)) {
            continue
          }
          const ek = `${r.staff.toLowerCase()}|${r.businessDate}`
          expected[ek] = (expected[ek] ?? 0) + Number(r.totalCommission)
        }

        // Actual: sum canonical view across attribution branches per (staff, day).
        const canonical = buildCanonicalView(rows)
        const actual: Record<string, number> = {}
        for (const e of canonical) {
          const ek = `${e.staffLc}|${e.date}`
          actual[ek] = (actual[ek] ?? 0) + e.total
        }
        expect(actual).toEqual(expected)
      }),
      { numRuns: 100 },
    )
  })
})

// ---------------------------------------------------------------------------
// Property: salary board home-branch attribution + freelance exclusion
//
// Each non-freelance roster staff appears in their home-branch section
// IFF they have any non-zero canonical total at that branch in the
// cycle. Freelance roster members never appear. Multi-branch lists
// only staff with non-zero contributions at ≥2 distinct branches.
// ---------------------------------------------------------------------------
describe('Property: salary board home-branch attribution + freelance exclusion', () => {
  it('per-branch sections contain only eligible staff with non-zero totals at that branch', () => {
    const arbRoster = fc.array(
      fc.record({
        name: arbStaff,
        homeBranch: arbBranch,
        isFreelance: fc.boolean(),
      }),
      { minLength: 1, maxLength: 6 },
    ).map((entries) => {
      // Dedupe by name (case-insensitive); first occurrence wins.
      const seen = new Set<string>()
      const uniq: StaffMember[] = []
      for (const e of entries) {
        const lc = e.name.toLowerCase()
        if (seen.has(lc)) continue
        seen.add(lc)
        uniq.push(staff(e.name, e.homeBranch, { isFreelance: e.isFreelance }))
      }
      return uniq
    })

    fc.assert(
      fc.property(
        fc.array(arbRow, { minLength: 0, maxLength: 12 }),
        arbRoster,
        (rows, roster) => {
          const cycle: Cycle = mayCycle
          const board = buildSalaryBoard(rows, roster, cycle)

          // No freelance-roster name appears anywhere.
          const freelanceNames = new Set(
            roster.filter((r) => r.isFreelance).map((r) => r.name.toLowerCase()),
          )
          const allBoardNames: string[] = []
          for (const branch of BRANCHES) {
            const sec = board.perBranch[branch]
            if (sec) allBoardNames.push(...sec.staff.map((s) => s.name.toLowerCase()))
          }
          allBoardNames.push(...board.multiBranch.staff.map((s) => s.name.toLowerCase()))
          for (const n of allBoardNames) expect(freelanceNames.has(n)).toBe(false)

          // Independent canonical-aggregate per (staffLc, branch).
          const canonical = buildCanonicalView(rows.filter((r) => cycle.days.includes(r.businessDate)))
          const perStaffBranch = new Map<string, number>()
          const branchesByStaff = new Map<string, Set<Branch>>()
          for (const e of canonical) {
            const k = `${e.staffLc}|${e.branch}`
            perStaffBranch.set(k, (perStaffBranch.get(k) ?? 0) + e.total)
            if (!branchesByStaff.has(e.staffLc)) branchesByStaff.set(e.staffLc, new Set())
            branchesByStaff.get(e.staffLc)!.add(e.branch)
          }

          // Each non-freelance roster staff with non-zero total at branch B
          // appears in board.perBranch[B] with that exact total.
          for (const m of roster) {
            if (m.isFreelance || !m.isActive) continue
            for (const branch of BRANCHES) {
              const expected = perStaffBranch.get(`${m.name.toLowerCase()}|${branch}`) ?? 0
              const sec = board.perBranch[branch]
              const found = sec?.staff.find(
                (s) => s.name.toLowerCase() === m.name.toLowerCase(),
              )
              if (expected !== 0) {
                expect(found?.total).toBe(expected)
              } else {
                expect(found).toBeUndefined()
              }
            }
          }

          // Multi-branch contains exactly the eligible staff with ≥2 distinct
          // non-zero branches.
          const expectedMulti = new Set<string>()
          for (const m of roster) {
            if (m.isFreelance || !m.isActive) continue
            // Count distinct branches with non-zero total.
            const distinct = new Set<Branch>()
            for (const branch of BRANCHES) {
              if ((perStaffBranch.get(`${m.name.toLowerCase()}|${branch}`) ?? 0) !== 0) {
                distinct.add(branch)
              }
            }
            if (distinct.size >= 2) expectedMulti.add(m.name.toLowerCase())
          }
          const actualMulti = new Set(board.multiBranch.staff.map((s) => s.name.toLowerCase()))
          expect(actualMulti).toEqual(expectedMulti)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ---------------------------------------------------------------------------
// Property: cycle payout total equals sum of daily totals
// ---------------------------------------------------------------------------
describe('Property: cycle payout total equals sum of daily totals', () => {
  it('every BoardStaffRow.total equals sum of its daily values', () => {
    fc.assert(
      fc.property(fc.array(arbRow, { minLength: 0, maxLength: 12 }), (rows) => {
        const roster: StaffMember[] = [
          staff('beer', 'Kimberry'),
          staff('ney',  'Kimberry'),
          staff('nana', 'Bishop'),
          staff('lin',  'Bishop'),
          staff('nan',  'Chulia'),
          staff('pra',  'Chulia'),
        ]
        const board = buildSalaryBoard(rows, roster, mayCycle)
        const allRows: { name: string; daily: Record<string, number>; total: number }[] = []
        for (const branch of BRANCHES) {
          const sec = board.perBranch[branch]
          if (sec) allRows.push(...sec.staff)
        }
        allRows.push(...board.multiBranch.staff)
        for (const r of allRows) {
          const sum = Object.values(r.daily).reduce((s, v) => s + v, 0)
          expect(r.total).toBe(sum)
        }
      }),
      { numRuns: 100 },
    )
  })
})
