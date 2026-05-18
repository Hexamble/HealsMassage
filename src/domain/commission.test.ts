/**
 * Unit tests for `commission.ts` (heals-system-rebuild).
 *
 * Validates: Requirements 2.6, 2.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6,
 *            18.1, 18.4, 18.5.
 *
 * Property tests are deferred to optional task 4.2 / 4.3.
 *
 * Test framework: Jest (ts-jest), `domain` project (Node env).
 */

import {
  bookingBonus,
  computeCommission,
  lookupCustomerPrice,
  lookupFreelanceRate,
  lookupRegularRate,
  priceTableFromRows,
  type CommissionInput,
  type FreelanceRateRow,
  type PriceRow,
  type RegularRateRow,
} from './commission'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Two-tier rate table used by every test: a day-zero row at
 * `2025-01-01` and a refresh at `2025-06-01`. The lookup picks the
 * latest row whose `effectiveFrom <= businessDate`.
 */
const REGULAR_RATES: ReadonlyArray<RegularRateRow> = [
  { course: 'FR', duration: 60, branchGroup: 'all', amount: 23, effectiveFrom: '2025-01-01' },
  { course: 'FR', duration: 60, branchGroup: 'all', amount: 25, effectiveFrom: '2025-06-01' },
  { course: 'FR', duration: 90, branchGroup: 'all', amount: 31, effectiveFrom: '2025-01-01' },
  { course: 'FR', duration: 120, branchGroup: 'all', amount: 40, effectiveFrom: '2025-01-01' },
  { course: 'HS', duration: 60, branchGroup: 'all', amount: 26, effectiveFrom: '2025-01-01' },
]

const FREELANCE_RATES: ReadonlyArray<FreelanceRateRow> = [
  { course: 'FR', duration: 60, branchGroup: 'all', amount: 35, effectiveFrom: '2025-01-01' },
  { course: 'FR', duration: 60, branchGroup: 'all', amount: 36, effectiveFrom: '2025-06-01' },
  { course: 'FR', duration: 90, branchGroup: 'all', amount: 50, effectiveFrom: '2025-01-01' },
  { course: 'HS', duration: 60, branchGroup: 'all', amount: 38, effectiveFrom: '2025-01-01' },
]

const PRICE_ROWS: ReadonlyArray<PriceRow> = [
  // Bishop FR -2 RM is enforced at seed time per Req 2.7.
  { course: 'FR', duration: 60, branch: 'Kimberry', price: 70 },
  { course: 'FR', duration: 60, branch: 'Chulia', price: 70 },
  { course: 'FR', duration: 60, branch: 'Bishop', price: 68 },
  { course: 'FR', duration: 90, branch: 'Kimberry', price: 100 },
  { course: 'FR', duration: 90, branch: 'Bishop', price: 98 },
]
const PRICE_TABLE = priceTableFromRows(PRICE_ROWS)

/** Helper to build a `CommissionInput` with sensible defaults. */
function input(overrides: Partial<CommissionInput> = {}): CommissionInput {
  return {
    course: 'FR',
    duration: 60,
    branch: 'Kimberry',
    businessDate: '2025-03-01',
    method: 'CASH',
    staffBalm: false,
    booking: false,
    addon: 0,
    regularRates: REGULAR_RATES,
    freelanceRates: FREELANCE_RATES,
    priceTable: PRICE_TABLE,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// lookupCustomerPrice
// ---------------------------------------------------------------------------

describe('lookupCustomerPrice', () => {
  it('returns 70 for FR/60 at Kimberry', () => {
    expect(lookupCustomerPrice('FR', 60, 'Kimberry', PRICE_TABLE)).toBe(70)
  })

  it('returns 70 for FR/60 at Chulia', () => {
    expect(lookupCustomerPrice('FR', 60, 'Chulia', PRICE_TABLE)).toBe(70)
  })

  it('returns 68 for FR/60 at Bishop (seeded -2 RM per Req 2.7)', () => {
    expect(lookupCustomerPrice('FR', 60, 'Bishop', PRICE_TABLE)).toBe(68)
  })

  it('returns 0 when the (course, duration, branch) cell is missing', () => {
    expect(lookupCustomerPrice('HS', 60, 'Kimberry', PRICE_TABLE)).toBe(0)
  })

  it('coerces numeric-string prices (DB numeric(10,2) round-trip)', () => {
    const rows = [
      { course: 'FR' as const, duration: 60 as const, branch: 'Kimberry' as const, price: '70.00' as unknown as number },
    ]
    const table = priceTableFromRows(rows)
    expect(lookupCustomerPrice('FR', 60, 'Kimberry', table)).toBe(70)
  })
})

// ---------------------------------------------------------------------------
// lookupRegularRate
// ---------------------------------------------------------------------------

describe('lookupRegularRate', () => {
  it('returns the day-zero rate for a date before the refresh', () => {
    expect(
      lookupRegularRate('FR', 60, REGULAR_RATES, 'all', '2025-03-01'),
    ).toBe(23)
  })

  it('returns the refreshed rate on or after the refresh date', () => {
    expect(
      lookupRegularRate('FR', 60, REGULAR_RATES, 'all', '2025-06-01'),
    ).toBe(25)
    expect(
      lookupRegularRate('FR', 60, REGULAR_RATES, 'all', '2025-12-31'),
    ).toBe(25)
  })

  it('returns 0 when no row matches the (course, duration) lookup', () => {
    expect(
      lookupRegularRate('THC', 60, REGULAR_RATES, 'all', '2025-03-01'),
    ).toBe(0)
  })

  it('returns 0 when business date is before any effective row', () => {
    expect(
      lookupRegularRate('FR', 60, REGULAR_RATES, 'all', '2024-12-31'),
    ).toBe(0)
  })

  it('matches branchGroup exactly — a per-branch override does not leak across groups', () => {
    const rates: RegularRateRow[] = [
      { course: 'FR', duration: 60, branchGroup: 'all', amount: 23, effectiveFrom: '2025-01-01' },
      { course: 'FR', duration: 60, branchGroup: 'Kimberry', amount: 30, effectiveFrom: '2025-01-01' },
    ]
    expect(lookupRegularRate('FR', 60, rates, 'all', '2025-03-01')).toBe(23)
    expect(lookupRegularRate('FR', 60, rates, 'Kimberry', '2025-03-01')).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// lookupFreelanceRate (incl. Bishop FR floor)
// ---------------------------------------------------------------------------

describe('lookupFreelanceRate', () => {
  it('returns the Kimberry/Chulia rate for non-Bishop branches', () => {
    expect(
      lookupFreelanceRate('FR', 60, 'Kimberry', FREELANCE_RATES, '2025-03-01'),
    ).toBe(35)
    expect(
      lookupFreelanceRate('FR', 60, 'Chulia', FREELANCE_RATES, '2025-03-01'),
    ).toBe(35)
  })

  it('returns Bishop FR rate as max(0, kcRate - 1) per Req 6.6 / 18.4', () => {
    // kcRate 35 → Bishop 34
    expect(
      lookupFreelanceRate('FR', 60, 'Bishop', FREELANCE_RATES, '2025-03-01'),
    ).toBe(34)
    // FR 90: kcRate 50 → Bishop 49
    expect(
      lookupFreelanceRate('FR', 90, 'Bishop', FREELANCE_RATES, '2025-03-01'),
    ).toBe(49)
  })

  it('Bishop FR floor: kcRate=2 → Bishop=1', () => {
    const rates: FreelanceRateRow[] = [
      { course: 'FR', duration: 60, branchGroup: 'all', amount: 2, effectiveFrom: '2025-01-01' },
    ]
    expect(
      lookupFreelanceRate('FR', 60, 'Bishop', rates, '2025-03-01'),
    ).toBe(1)
  })

  it('Bishop FR floor: kcRate=1 → Bishop=0 (clamped, not -0)', () => {
    const rates: FreelanceRateRow[] = [
      { course: 'FR', duration: 60, branchGroup: 'all', amount: 1, effectiveFrom: '2025-01-01' },
    ]
    expect(
      lookupFreelanceRate('FR', 60, 'Bishop', rates, '2025-03-01'),
    ).toBe(0)
  })

  it('Bishop FR floor: kcRate=0 → Bishop=0 (no negative result)', () => {
    const rates: FreelanceRateRow[] = [
      { course: 'FR', duration: 60, branchGroup: 'all', amount: 0, effectiveFrom: '2025-01-01' },
    ]
    expect(
      lookupFreelanceRate('FR', 60, 'Bishop', rates, '2025-03-01'),
    ).toBe(0)
  })

  it('Bishop floor only applies to course=FR; other courses lookup straight', () => {
    expect(
      lookupFreelanceRate('HS', 60, 'Bishop', FREELANCE_RATES, '2025-03-01'),
    ).toBe(38)
  })

  it('honours effective_from versioning', () => {
    expect(
      lookupFreelanceRate('FR', 60, 'Kimberry', FREELANCE_RATES, '2025-05-31'),
    ).toBe(35)
    expect(
      lookupFreelanceRate('FR', 60, 'Kimberry', FREELANCE_RATES, '2025-06-01'),
    ).toBe(36)
    // Bishop after the refresh: max(0, 36 - 1) = 35
    expect(
      lookupFreelanceRate('FR', 60, 'Bishop', FREELANCE_RATES, '2025-06-01'),
    ).toBe(35)
  })

  it('returns 0 when no row matches', () => {
    expect(
      lookupFreelanceRate('THC', 60, 'Kimberry', FREELANCE_RATES, '2025-03-01'),
    ).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// bookingBonus
// ---------------------------------------------------------------------------

describe('bookingBonus', () => {
  it.each([
    [60, 3],
    [90, 4.5],
    [120, 6],
    [30, 0],
  ])('duration %i → %f', (duration, expected) => {
    expect(bookingBonus(duration as 30 | 60 | 90 | 120)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// computeCommission
// ---------------------------------------------------------------------------

describe('computeCommission', () => {
  it('FR/60 CASH at Kimberry, no modifiers → total 23, base 23, balm/book/addon 0', () => {
    const result = computeCommission(input())
    expect(result).toEqual({ base: 23, balm: 0, book: 0, addon: 0, total: 23 })
  })

  it('staffBalm=true → balm = 3 (FR/60 → 26)', () => {
    const result = computeCommission(input({ staffBalm: true }))
    expect(result.balm).toBe(3)
    expect(result.total).toBe(26)
  })

  it('booking=true on FR/60 → book = 3 (FR/60 → 26)', () => {
    const result = computeCommission(input({ booking: true }))
    expect(result.book).toBe(3)
    expect(result.total).toBe(26)
  })

  it('booking=true on FR/90 → book = 4.5 (31 + 4.5 = 35.5)', () => {
    const result = computeCommission(
      input({ duration: 90, booking: true }),
    )
    expect(result.base).toBe(31)
    expect(result.book).toBe(4.5)
    expect(result.total).toBe(35.5)
  })

  it('booking=true on FR/120 → book = 6 (40 + 6 = 46)', () => {
    const result = computeCommission(
      input({ duration: 120, booking: true }),
    )
    expect(result.base).toBe(40)
    expect(result.book).toBe(6)
    expect(result.total).toBe(46)
  })

  it('staffBalm + booking + addon=5 on FR/60 → 23 + 3 + 3 + 5 = 34', () => {
    const result = computeCommission(
      input({ staffBalm: true, booking: true, addon: 5 }),
    )
    expect(result).toEqual({ base: 23, balm: 3, book: 3, addon: 5, total: 34 })
  })

  it('negative addon is clamped to 0', () => {
    const result = computeCommission(input({ addon: -5 }))
    expect(result.addon).toBe(0)
    expect(result.total).toBe(23)
  })

  it('Freelance method routes through freelance rate (FR/60 → 35)', () => {
    const result = computeCommission(input({ method: 'Freelance' }))
    expect(result.base).toBe(35)
    expect(result.total).toBe(35)
  })

  it('Freelance method, lowercase variant → also routes through freelance rate', () => {
    const result = computeCommission(input({ method: 'freelance' }))
    expect(result.base).toBe(35)
  })

  it('Freelance + Bishop FR/60 → kcRate-1 = 34 with floor', () => {
    const result = computeCommission(
      input({ method: 'Freelance', branch: 'Bishop' }),
    )
    expect(result.base).toBe(34)
    expect(result.total).toBe(34)
  })

  it.each([
    'EXTRA KM',
    'EXTRA BS',
    'EXTRA CL',
    'extra cl',
    'EXTRA-BS',
    'EXTRA  CHU',
  ])('EXTRA method "%s" → all-zero result', (method) => {
    const result = computeCommission(input({ method }))
    expect(result).toEqual({ base: 0, balm: 0, book: 0, addon: 0, total: 0 })
  })

  it('EXTRA short-circuit fires even with bonuses + addon', () => {
    const result = computeCommission(
      input({
        method: 'EXTRA CL',
        staffBalm: true,
        booking: true,
        addon: 50,
      }),
    )
    expect(result.total).toBe(0)
  })

  it('honours rate effective_from versioning', () => {
    // FR/60 was 23 day-zero, 25 from 2025-06-01.
    expect(
      computeCommission(input({ businessDate: '2025-05-31' })).base,
    ).toBe(23)
    expect(
      computeCommission(input({ businessDate: '2025-06-01' })).base,
    ).toBe(25)
  })

  it('returns base 0 when the rate row is absent', () => {
    const result = computeCommission(
      input({ course: 'THC', duration: 60 }),
    )
    expect(result.base).toBe(0)
    expect(result.total).toBe(0)
  })

  it('total === base + balm + book + addon (Req 20.7)', () => {
    const result = computeCommission(
      input({
        course: 'FR',
        duration: 90,
        staffBalm: true,
        booking: true,
        addon: 7,
      }),
    )
    expect(result.total).toBe(result.base + result.balm + result.book + result.addon)
    expect(result.balm).toBe(3)
    expect(result.book).toBe(4.5)
    expect(result.addon).toBe(7)
  })
})
