/**
 * Tests for `queue.ts` — fair-rotation queue (Q system).
 *
 * Unit examples cover the worked cases in design.md §"buildQueue" and
 * the tie-break chain. Property tests assert the fairness invariants
 * (Properties 16–20) hold across many inputs.
 *
 * Validates:
 *   - Requirements 4.2 (Property 16: lower today earner sorts higher)
 *   - Requirements 4.3 (Property 17: zero-earner staff first)
 *   - Requirements 4.4 (Property 18: yesterday tie-break)
 *   - Requirements 4.6 (Property 20: deterministic ordering)
 *   - Requirements 4.7, 4.8 (Property 19: busy staff held)
 *   - Requirements 4.9 (EXTRA rows excluded from today's earnings)
 *   - Requirements 4.11 (Property 20: referential transparency)
 */

import fc from 'fast-check'
import { buildQueue } from './queue'
import type { Branch } from './row-id'

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('buildQueue — unit cases', () => {
  it('empty roster returns empty queue', () => {
    const q = buildQueue({
      branch: 'Kimberry',
      businessDate: '2026-05-15',
      todayRows: [],
      yesterdayRows: [],
      todayRoster: [],
    })
    expect(q).toEqual([])
  })

  it('all-zero earnings, no busy → ordered by lower(staff) ASC', () => {
    const q = buildQueue({
      branch: 'Kimberry',
      businessDate: '2026-05-15',
      todayRows: [],
      yesterdayRows: [],
      todayRoster: ['Beer', 'Aom', 'Lin', 'Nan'],
    })
    // All four are isNew (zero earnings), all have equal yesterdayEarned (0),
    // no lastEnd → tie-break is lower(staff) ASC.
    expect(q.map((e) => e.staff)).toEqual(['Aom', 'Beer', 'Lin', 'Nan'])
    expect(q.map((e) => e.position)).toEqual([1, 2, 3, 4])
    expect(q.every((e) => e.status === 'free')).toBe(true)
    expect(q.every((e) => e.isNew)).toBe(true)
  })

  it('one busy staff in middle → busy=position 0, others 1..n-1', () => {
    // Lin is currently busy (timeIn 14:00, timeOut 15:00, nowKL 14:30).
    const q = buildQueue({
      branch: 'Kimberry',
      businessDate: '2026-05-15',
      todayRows: [
        {
          staff: 'Lin',
          branch: 'Kimberry',
          businessDate: '2026-05-15',
          method: 'CASH',
          commission: 23,
          timeIn: '14:00',
          timeOut: '15:00',
          duration: 60,
        },
      ],
      yesterdayRows: [],
      todayRoster: ['Aom', 'Beer', 'Lin', 'Nan'],
      nowKL: '14:30',
    })

    const lin = q.find((e) => e.staff === 'Lin')!
    expect(lin.status).toBe('busy')
    expect(lin.position).toBe(0)
    expect(lin.busyUntil).toBe('15:00')

    // The other three are isNew (zero earnings) so they sort ahead of Lin
    // alphabetically. Lin's todayEarned=23 puts her behind in fairness, but
    // she's busy so position=0 regardless.
    const free = q.filter((e) => e.status === 'free')
    expect(free.map((e) => e.staff)).toEqual(['Aom', 'Beer', 'Nan'])
    expect(free.map((e) => e.position)).toEqual([1, 2, 3])
  })

  it('pinnedOrder puts those staff first regardless of earnings', () => {
    const q = buildQueue({
      branch: 'Kimberry',
      businessDate: '2026-05-15',
      todayRows: [
        // Beer earned 100 today (would normally sort last), Lin earned 50.
        {
          staff: 'Beer',
          branch: 'Kimberry',
          businessDate: '2026-05-15',
          method: 'CASH',
          commission: 100,
          timeIn: '10:00',
          timeOut: '11:00',
          duration: 60,
        },
        {
          staff: 'Lin',
          branch: 'Kimberry',
          businessDate: '2026-05-15',
          method: 'CASH',
          commission: 50,
          timeIn: '11:00',
          timeOut: '12:00',
          duration: 60,
        },
      ],
      yesterdayRows: [],
      todayRoster: ['Aom', 'Beer', 'Lin', 'Nan'],
      pinnedOrder: ['Beer', 'Lin'],
      nowKL: '13:00', // both sessions ended → not busy
    })
    expect(q.map((e) => e.staff)).toEqual(['Beer', 'Lin', 'Aom', 'Nan'])
  })

  it('EXTRA rows do not contribute to today earnings (Property 4.9)', () => {
    const q = buildQueue({
      branch: 'Kimberry',
      businessDate: '2026-05-15',
      todayRows: [
        {
          staff: 'Beer',
          branch: 'Kimberry',
          businessDate: '2026-05-15',
          method: 'EXTRA CL',
          commission: 31,
          timeIn: '14:00',
          timeOut: '15:30',
          duration: 90,
        },
      ],
      yesterdayRows: [],
      todayRoster: ['Beer', 'Aom'],
      nowKL: '16:00',
    })
    const beer = q.find((e) => e.staff === 'Beer')!
    expect(beer.todayEarned).toBe(0)
    expect(beer.isNew).toBe(true)
  })

  it('yesterday tie-break: lower yesterdayEarned sorts higher (Property 18)', () => {
    // Aom and Beer both earned 50 today (not new). Aom 30 yesterday, Beer 20.
    // → Beer (lower yesterday) sorts higher.
    const q = buildQueue({
      branch: 'Kimberry',
      businessDate: '2026-05-15',
      todayRows: [
        {
          staff: 'Aom',
          branch: 'Kimberry',
          businessDate: '2026-05-15',
          method: 'CASH',
          commission: 50,
          timeIn: '10:00',
          timeOut: '11:00',
          duration: 60,
        },
        {
          staff: 'Beer',
          branch: 'Kimberry',
          businessDate: '2026-05-15',
          method: 'CASH',
          commission: 50,
          timeIn: '11:00',
          timeOut: '12:00',
          duration: 60,
        },
      ],
      yesterdayRows: [
        {
          staff: 'Aom',
          branch: 'Kimberry',
          businessDate: '2026-05-14',
          method: 'CASH',
          commission: 30,
          timeIn: '10:00',
          timeOut: '11:00',
          duration: 60,
        },
        {
          staff: 'Beer',
          branch: 'Kimberry',
          businessDate: '2026-05-14',
          method: 'CASH',
          commission: 20,
          timeIn: '10:00',
          timeOut: '11:00',
          duration: 60,
        },
      ],
      todayRoster: ['Aom', 'Beer'],
      nowKL: '13:00',
    })
    expect(q.map((e) => e.staff)).toEqual(['Beer', 'Aom'])
  })
})

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

const arbStaffName = fc.constantFrom(
  'Aom',
  'Beer',
  'Lin',
  'Nan',
  'Nana',
  'Ney',
  'Pra',
)

const arbCommission = fc.integer({ min: 1, max: 100 })

const arbRoster = fc.uniqueArray(arbStaffName, { minLength: 3, maxLength: 6 })

function arbTodayRow(roster: string[], date: string) {
  return fc.record({
    staff: fc.constantFrom(...roster),
    branch: fc.constant<Branch>('Kimberry'),
    businessDate: fc.constant(date),
    // Exclude EXTRA + Freelance so generated rows always count toward earnings.
    method: fc.constantFrom('CASH', 'QR', 'CREDIT'),
    commission: arbCommission,
    timeIn: fc.constantFrom('10:00', '11:00', '12:00'),
    timeOut: fc.constantFrom('11:00', '12:00', '13:00'),
    duration: fc.constant(60),
  })
}

function arbTodayRows(roster: string[]) {
  return fc.array(arbTodayRow(roster, '2026-05-15'), { maxLength: 8 })
}

function arbYesterdayRows(roster: string[]) {
  return fc.array(arbTodayRow(roster, '2026-05-14'), { maxLength: 8 })
}

describe('buildQueue — property tests', () => {
  // Validates: Requirements 4.2 (Property 16)
  it('Property 16: free non-new staff with lower todayEarned sort higher', () => {
    fc.assert(
      fc.property(
        arbRoster.chain((roster) =>
          fc.tuple(
            fc.constant(roster),
            arbTodayRows(roster),
            arbYesterdayRows(roster),
          ),
        ),
        ([roster, todayRows, yesterdayRows]) => {
          const q = buildQueue({
            branch: 'Kimberry',
            businessDate: '2026-05-15',
            todayRows,
            yesterdayRows,
            todayRoster: roster,
            // nowKL after all generated timeOut values → no one is busy.
            nowKL: '23:00',
          })
          for (let i = 0; i < q.length; i++) {
            for (let j = 0; j < q.length; j++) {
              const a = q[i]
              const b = q[j]
              if (a.status !== 'free' || b.status !== 'free') continue
              if (a.isNew || b.isNew) continue
              if (a.todayEarned < b.todayEarned) {
                expect(a.position).toBeLessThan(b.position)
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  // Validates: Requirements 4.3 (Property 17)
  it('Property 17: zero-earner free staff sort ahead of non-zero earners', () => {
    fc.assert(
      fc.property(
        arbRoster.chain((roster) =>
          fc.tuple(
            fc.constant(roster),
            arbTodayRows(roster),
            arbYesterdayRows(roster),
          ),
        ),
        ([roster, todayRows, yesterdayRows]) => {
          const q = buildQueue({
            branch: 'Kimberry',
            businessDate: '2026-05-15',
            todayRows,
            yesterdayRows,
            todayRoster: roster,
            nowKL: '23:00',
          })
          for (let i = 0; i < q.length; i++) {
            for (let j = 0; j < q.length; j++) {
              const a = q[i]
              const b = q[j]
              if (a.status !== 'free' || b.status !== 'free') continue
              if (a.isNew && !b.isNew) {
                expect(a.position).toBeLessThan(b.position)
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  // Validates: Requirements 4.4 (Property 18)
  it('Property 18: equal todayEarned tie-break by lower yesterdayEarned', () => {
    fc.assert(
      fc.property(
        arbRoster.chain((roster) =>
          fc.tuple(
            fc.constant(roster),
            arbTodayRows(roster),
            arbYesterdayRows(roster),
          ),
        ),
        ([roster, todayRows, yesterdayRows]) => {
          const q = buildQueue({
            branch: 'Kimberry',
            businessDate: '2026-05-15',
            todayRows,
            yesterdayRows,
            todayRoster: roster,
            nowKL: '23:00',
          })
          for (let i = 0; i < q.length; i++) {
            for (let j = 0; j < q.length; j++) {
              const a = q[i]
              const b = q[j]
              if (a.status !== 'free' || b.status !== 'free') continue
              if (a.isNew || b.isNew) continue
              if (a.todayEarned !== b.todayEarned) continue
              if (a.yesterdayEarned < b.yesterdayEarned) {
                expect(a.position).toBeLessThan(b.position)
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  // Validates: Requirements 4.7, 4.8 (Property 19)
  it('Property 19: busy staff have status=busy and position=0', () => {
    // A staff is busy when: timeIn set AND (timeOut null OR timeOut > nowKL).
    // Build rows guaranteed to be open at nowKL='13:00': timeIn 12:30,
    // timeOut 13:30. At least one row exists per generated input so at
    // least one staff is busy.
    fc.assert(
      fc.property(
        arbRoster.chain((roster) =>
          fc.tuple(
            fc.constant(roster),
            fc.array(
              fc.record({
                staff: fc.constantFrom(...roster),
                branch: fc.constant<Branch>('Kimberry'),
                businessDate: fc.constant('2026-05-15'),
                method: fc.constantFrom('CASH', 'QR', 'CREDIT'),
                commission: arbCommission,
                timeIn: fc.constant('12:30'),
                timeOut: fc.constant('13:30'),
                duration: fc.constant(60),
              }),
              { minLength: 1, maxLength: 4 },
            ),
          ),
        ),
        ([roster, busyRows]) => {
          const q = buildQueue({
            branch: 'Kimberry',
            businessDate: '2026-05-15',
            todayRows: busyRows,
            yesterdayRows: [],
            todayRoster: roster,
            nowKL: '13:00',
          })
          const busyStaffLower = new Set(
            busyRows.map((r) => r.staff.toLowerCase()),
          )
          for (const entry of q) {
            if (busyStaffLower.has(entry.staff.toLowerCase())) {
              expect(entry.status).toBe('busy')
              expect(entry.position).toBe(0)
              expect(entry.busyUntil).toBe('13:30')
            }
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  // Validates: Requirements 4.6, 4.11 (Property 20)
  it('Property 20: identical input produces identical output (referential transparency)', () => {
    fc.assert(
      fc.property(
        arbRoster.chain((roster) =>
          fc.tuple(
            fc.constant(roster),
            arbTodayRows(roster),
            arbYesterdayRows(roster),
            fc.option(
              fc.uniqueArray(fc.constantFrom(...roster), {
                minLength: 1,
                maxLength: roster.length,
              }),
              { nil: undefined },
            ),
            fc.constantFrom('10:00', '13:00', '17:00', '23:00'),
          ),
        ),
        ([roster, todayRows, yesterdayRows, pinnedOrder, nowKL]) => {
          const input = {
            branch: 'Kimberry' as Branch,
            businessDate: '2026-05-15',
            todayRows,
            yesterdayRows,
            todayRoster: roster,
            pinnedOrder,
            nowKL,
          }
          const a = buildQueue(input)
          const b = buildQueue(input)
          expect(a).toEqual(b)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ===========================================================================
// computeQueueBoard — heals-system-rebuild Task 4.10
// ===========================================================================

import { fromZonedTime } from 'date-fns-tz'
import { computeQueueBoard } from './queue'
import type {
  StaffMember,
  TransactionRow,
} from './types'

/**
 * Build a UTC `Date` from a KL `yyyy-MM-dd HH:mm` wall-clock string.
 * Used by the test suite to construct `now` and verify `timeOut` math
 * in the same time space the implementation uses.
 */
function nowKL(date: string, hhmm: string): Date {
  return fromZonedTime(`${date} ${hhmm}:00`, 'Asia/Kuala_Lumpur')
}

/**
 * Minimal `StaffMember` factory — sets sensible defaults so each test
 * only declares the fields that matter.
 */
function staff(
  name: string,
  overrides: Partial<StaffMember> = {},
): StaffMember {
  return {
    id: `staff-${name.toLowerCase()}`,
    name,
    homeBranch: 'Kimberry',
    isFreelance: false,
    isActive: true,
    ...overrides,
  }
}

/**
 * Minimal `TransactionRow` factory. The queue projection only reads
 * `staff`, `businessDate`, `timeIn`, `timeOut`, and `course`, but the
 * full type is satisfied so tests stay TS-strict.
 */
function tx(opts: {
  id?: string
  staff: string
  businessDate: string
  timeIn: string | null
  timeOut: string | null
  course?: TransactionRow['course']
}): TransactionRow {
  return {
    id: opts.id ?? `tx-${opts.staff}-${opts.timeIn ?? 'null'}`,
    branch: 'Kimberry',
    businessDate: opts.businessDate,
    cashierRowNumber: 1,
    staff: opts.staff,
    course: opts.course ?? 'FR',
    duration: 60,
    timeIn: opts.timeIn,
    timeOut: opts.timeOut,
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
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    createdBy: null,
  }
}

describe('computeQueueBoard — unit cases', () => {
  const DATE = '2026-05-15'

  it('staff with no transactions are free', () => {
    const roster = [staff('Aom'), staff('Beer')]
    const board = computeQueueBoard(roster, [], nowKL(DATE, '14:00'))
    expect(board).toEqual([
      {
        staffName: 'Aom',
        status: 'free',
        minutesRemaining: null,
        currentCourse: null,
      },
      {
        staffName: 'Beer',
        status: 'free',
        minutesRemaining: null,
        currentCourse: null,
      },
    ])
  })

  it('busy staff: timeOut in future → busy with countdown and currentCourse', () => {
    // Lin checked in at 14:00, out at 15:00. now = 14:30 → 30 min remaining.
    const roster = [staff('Lin')]
    const rows: TransactionRow[] = [
      tx({
        staff: 'Lin',
        businessDate: DATE,
        timeIn: '14:00',
        timeOut: '15:00',
        course: 'HS',
      }),
    ]
    const [entry] = computeQueueBoard(roster, rows, nowKL(DATE, '14:30'))
    expect(entry.status).toBe('busy')
    expect(entry.minutesRemaining).toBe(30)
    expect(entry.currentCourse).toBe('HS')
  })

  it('exact time_out boundary → free (Req 16.3, no tolerance)', () => {
    const roster = [staff('Lin')]
    const rows: TransactionRow[] = [
      tx({
        staff: 'Lin',
        businessDate: DATE,
        timeIn: '14:00',
        timeOut: '15:00',
      }),
    ]
    // now = exactly 15:00 KL → strictly NOT before timeOut → free.
    const [entry] = computeQueueBoard(roster, rows, nowKL(DATE, '15:00'))
    expect(entry).toEqual({
      staffName: 'Lin',
      status: 'free',
      minutesRemaining: null,
      currentCourse: null,
    })
  })

  it('multiple sessions: takes the latest still-active session', () => {
    // Aom has two sessions today. The earlier one ended at 13:00 (already
    // free for it); the later one runs 14:00–15:00 and is the relevant one.
    // course of the latest active session is reported.
    const roster = [staff('Aom')]
    const rows: TransactionRow[] = [
      tx({
        id: 'tx-old',
        staff: 'Aom',
        businessDate: DATE,
        timeIn: '12:00',
        timeOut: '13:00',
        course: 'FR',
      }),
      tx({
        id: 'tx-new',
        staff: 'Aom',
        businessDate: DATE,
        timeIn: '14:00',
        timeOut: '15:00',
        course: 'BMT',
      }),
    ]
    const [entry] = computeQueueBoard(roster, rows, nowKL(DATE, '14:30'))
    expect(entry.status).toBe('busy')
    expect(entry.currentCourse).toBe('BMT')
    expect(entry.minutesRemaining).toBe(30)
  })

  it('missing time_in is treated as no active session → free', () => {
    const roster = [staff('Lin')]
    const rows: TransactionRow[] = [
      tx({
        staff: 'Lin',
        businessDate: DATE,
        timeIn: null,
        timeOut: '15:00',
      }),
    ]
    const [entry] = computeQueueBoard(roster, rows, nowKL(DATE, '14:30'))
    expect(entry.status).toBe('free')
    expect(entry.minutesRemaining).toBeNull()
    expect(entry.currentCourse).toBeNull()
  })

  it('missing time_out is treated as no active session → free', () => {
    const roster = [staff('Lin')]
    const rows: TransactionRow[] = [
      tx({
        staff: 'Lin',
        businessDate: DATE,
        timeIn: '14:00',
        timeOut: null,
      }),
    ]
    const [entry] = computeQueueBoard(roster, rows, nowKL(DATE, '14:30'))
    expect(entry.status).toBe('free')
    expect(entry.minutesRemaining).toBeNull()
    expect(entry.currentCourse).toBeNull()
  })

  it('staff not in roster are excluded from the board entirely', () => {
    // Two transactions exist — one for a rostered staff (Aom), one for a
    // ghost staff not in roster (Ghost). The board only reports Aom.
    const roster = [staff('Aom')]
    const rows: TransactionRow[] = [
      tx({
        staff: 'Aom',
        businessDate: DATE,
        timeIn: '14:00',
        timeOut: '15:00',
      }),
      tx({
        staff: 'Ghost',
        businessDate: DATE,
        timeIn: '14:00',
        timeOut: '15:00',
      }),
    ]
    const board = computeQueueBoard(roster, rows, nowKL(DATE, '14:30'))
    expect(board.map((e) => e.staffName)).toEqual(['Aom'])
    expect(board[0].status).toBe('busy')
  })

  it('staff name match is case-insensitive', () => {
    const roster = [staff('Lin')]
    const rows: TransactionRow[] = [
      tx({
        staff: 'lin', // lowercase
        businessDate: DATE,
        timeIn: '14:00',
        timeOut: '15:00',
      }),
    ]
    const [entry] = computeQueueBoard(roster, rows, nowKL(DATE, '14:30'))
    expect(entry.status).toBe('busy')
    expect(entry.minutesRemaining).toBe(30)
  })

  it('roster order is preserved in output', () => {
    const roster = [staff('Nan'), staff('Aom'), staff('Beer')]
    const board = computeQueueBoard(roster, [], nowKL(DATE, '14:00'))
    expect(board.map((e) => e.staffName)).toEqual(['Nan', 'Aom', 'Beer'])
  })

  it('minutesRemaining is floor of seconds-remaining ÷ 60', () => {
    // timeOut 15:00, now 14:00:30 → 59 min 30 sec remaining → floor = 59.
    const roster = [staff('Lin')]
    const rows: TransactionRow[] = [
      tx({
        staff: 'Lin',
        businessDate: DATE,
        timeIn: '14:00',
        timeOut: '15:00',
      }),
    ]
    // Construct now at 14:00:30 KL: easier to take the 14:00 instant + 30s.
    const nowAt1400 = nowKL(DATE, '14:00').getTime()
    const now = new Date(nowAt1400 + 30_000)
    const [entry] = computeQueueBoard(roster, rows, now)
    expect(entry.status).toBe('busy')
    expect(entry.minutesRemaining).toBe(59)
  })
})
