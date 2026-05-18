/**
 * Unit tests for `validators.ts` — Zod schemas for cashier and owner
 * server-action inputs.
 *
 * Covers:
 *   - missing-field rejection (transaction, expense)
 *   - payment-split mismatch rejection for CASH/QR/CREDIT
 *   - EXTRA all-zero enforcement (cash, qr, credit, price)
 *   - staff normalisation: trim, collapse internal whitespace, reject empty
 *   - expense Item-empty / Amount-non-positive rejection
 *   - payCycleStartDay range [1, 28]
 *
 * Validates: Requirements 2.1, 2.2, 2.4, 2.5, 2.10, 2.11, 17.1, 17.3.
 */

import {
  transactionSchema,
  expenseSchema,
  payCycleStartDaySchema,
  staffSchema,
  rosterSchema,
  priceSchema,
  commissionRateSchema,
  normaliseStaffName,
} from './validators'

// ---------------------------------------------------------------------------
// Helper — minimal valid transaction payload, easily mutated per test
// ---------------------------------------------------------------------------
const validTxn = () => ({
  branch: 'Kimberry' as const,
  cashierRowNumber: 1,
  staff: 'Beer',
  course: 'FR' as const,
  duration: 60 as const,
  method: 'CASH',
  cash: 88,
  qr: 0,
  credit: 0,
  price: 88,
})

// ---------------------------------------------------------------------------
// transactionSchema — happy path + missing-field rejection (Req 2.1, 2.2)
// ---------------------------------------------------------------------------
describe('transactionSchema — happy path', () => {
  test('accepts a balanced CASH session', () => {
    const result = transactionSchema.safeParse(validTxn())
    expect(result.success).toBe(true)
  })

  test('accepts a balanced QR/CREDIT split', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      method: 'QR',
      cash: 0,
      qr: 50,
      credit: 38,
      price: 88,
    })
    expect(result.success).toBe(true)
  })

  test('accepts EXTRA KM with all-zero amounts', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      method: 'EXTRA KM',
      cash: 0,
      qr: 0,
      credit: 0,
      price: 0,
    })
    expect(result.success).toBe(true)
  })

  test('accepts Freelance method (validator does not enforce roster)', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      method: 'Freelance',
      // Freelance is not a real-payment method, so the validator does
      // not enforce cash+qr+credit === price; the server action picks
      // commission from the freelance rate table instead.
      cash: 0,
      qr: 0,
      credit: 0,
      price: 0,
    })
    expect(result.success).toBe(true)
  })
})

describe('transactionSchema — missing required fields (Req 2.2)', () => {
  test.each([
    ['branch'],
    ['cashierRowNumber'],
    ['staff'],
    ['course'],
    ['duration'],
    ['method'],
  ])('rejects payload missing %s', (field) => {
    const payload = validTxn() as Record<string, unknown>
    delete payload[field]
    const result = transactionSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  test('rejects empty staff string', () => {
    const result = transactionSchema.safeParse({ ...validTxn(), staff: '' })
    expect(result.success).toBe(false)
  })

  test('rejects whitespace-only staff string', () => {
    const result = transactionSchema.safeParse({ ...validTxn(), staff: '   ' })
    expect(result.success).toBe(false)
  })

  test('rejects non-positive cashierRowNumber', () => {
    const a = transactionSchema.safeParse({ ...validTxn(), cashierRowNumber: 0 })
    const b = transactionSchema.safeParse({ ...validTxn(), cashierRowNumber: -1 })
    expect(a.success).toBe(false)
    expect(b.success).toBe(false)
  })

  test('rejects course outside enum', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      course: 'XX' as unknown,
    })
    expect(result.success).toBe(false)
  })

  test('rejects duration outside enum', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      duration: 45 as unknown,
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// transactionSchema — payment-split mismatch (Req 2.4)
// ---------------------------------------------------------------------------
describe('transactionSchema — payment split for CASH/QR/CREDIT (Req 2.4)', () => {
  test('rejects when cash + qr + credit ≠ price', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      cash: 50,
      qr: 30,
      credit: 0,
      price: 88, // 80 ≠ 88
    })
    expect(result.success).toBe(false)
  })

  test('accepts a 0.005 floating-point drift (within 1 sen tolerance)', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      cash: 88.005,
      qr: 0,
      credit: 0,
      price: 88,
    })
    expect(result.success).toBe(true)
  })

  test('rejects a 0.5 RM drift (outside 1 sen tolerance)', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      cash: 88.5,
      qr: 0,
      credit: 0,
      price: 88,
    })
    expect(result.success).toBe(false)
  })

  test('accepts a multi-method split that balances exactly', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      method: 'CREDIT',
      cash: 30,
      qr: 20,
      credit: 38,
      price: 88,
    })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// transactionSchema — EXTRA all-zero enforcement (Req 2.5, 5.x)
// ---------------------------------------------------------------------------
describe('transactionSchema — EXTRA all-zero enforcement (Req 2.5)', () => {
  test.each([
    ['EXTRA KM'],
    ['EXTRA BS'],
    ['EXTRA CL'],
    ['extra cl'], // case-insensitive variant
    ['EXTRA  CHU'], // double-space + Chulia long form
  ])('accepts %s with cash=qr=credit=price=0', (method) => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      method,
      cash: 0,
      qr: 0,
      credit: 0,
      price: 0,
    })
    expect(result.success).toBe(true)
  })

  test('rejects EXTRA KM with non-zero price', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      method: 'EXTRA KM',
      cash: 0,
      qr: 0,
      credit: 0,
      price: 88,
    })
    expect(result.success).toBe(false)
  })

  test.each([
    ['cash', { cash: 1, qr: 0, credit: 0, price: 0 }],
    ['qr', { cash: 0, qr: 1, credit: 0, price: 0 }],
    ['credit', { cash: 0, qr: 0, credit: 1, price: 0 }],
  ])('rejects EXTRA BS with non-zero %s', (_, amounts) => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      method: 'EXTRA BS',
      ...amounts,
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// transactionSchema — staff normalisation (Req 2.10, 2.11)
// ---------------------------------------------------------------------------
describe('transactionSchema — staff normalisation (Req 2.10, 2.11)', () => {
  test('trims leading and trailing whitespace', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      staff: '  Beer  ',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.staff).toBe('Beer')
  })

  test('collapses internal whitespace runs to a single space', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      staff: 'Mary  \t  Jane',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.staff).toBe('Mary Jane')
  })

  test('rejects staff that is empty after trimming', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      staff: '   \t  ',
    })
    expect(result.success).toBe(false)
  })

  test('preserves non-whitespace casing', () => {
    const result = transactionSchema.safeParse({
      ...validTxn(),
      staff: 'beer',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.staff).toBe('beer')
  })
})

// ---------------------------------------------------------------------------
// normaliseStaffName — directly exercise the helper
// ---------------------------------------------------------------------------
describe('normaliseStaffName', () => {
  test.each<[string, string]>([
    ['Beer', 'Beer'],
    ['  Beer  ', 'Beer'],
    ['Mary Jane', 'Mary Jane'],
    ['Mary  Jane', 'Mary Jane'],
    ['  Mary   Jane  ', 'Mary Jane'],
    ['\tBeer\n', 'Beer'],
    ['', ''],
    ['   ', ''],
  ])('normaliseStaffName(%p) === %p', (input, expected) => {
    expect(normaliseStaffName(input)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// expenseSchema (Req 17.1, 17.3)
// ---------------------------------------------------------------------------
describe('expenseSchema — happy path', () => {
  test('accepts a valid cashier expense', () => {
    const result = expenseSchema.safeParse({
      branch: 'Kimberry',
      item: 'Bottled water',
      amount: 4.5,
      method: 'CASH',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.note).toBe('')
  })

  test('trims item whitespace', () => {
    const result = expenseSchema.safeParse({
      branch: 'Bishop',
      item: '  Towels  ',
      amount: 12,
      method: 'QR',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.item).toBe('Towels')
  })
})

describe('expenseSchema — empty Item / non-positive Amount (Req 17.3)', () => {
  test('rejects empty item string', () => {
    const result = expenseSchema.safeParse({
      branch: 'Kimberry',
      item: '',
      amount: 5,
      method: 'CASH',
    })
    expect(result.success).toBe(false)
  })

  test('rejects whitespace-only item string', () => {
    const result = expenseSchema.safeParse({
      branch: 'Kimberry',
      item: '   ',
      amount: 5,
      method: 'CASH',
    })
    expect(result.success).toBe(false)
  })

  test('rejects amount === 0', () => {
    const result = expenseSchema.safeParse({
      branch: 'Kimberry',
      item: 'Cleaning',
      amount: 0,
      method: 'CASH',
    })
    expect(result.success).toBe(false)
  })

  test('rejects negative amount', () => {
    const result = expenseSchema.safeParse({
      branch: 'Kimberry',
      item: 'Cleaning',
      amount: -1,
      method: 'CASH',
    })
    expect(result.success).toBe(false)
  })

  test('rejects non-numeric amount', () => {
    const result = expenseSchema.safeParse({
      branch: 'Kimberry',
      item: 'Cleaning',
      amount: 'free' as unknown,
      method: 'CASH',
    })
    expect(result.success).toBe(false)
  })

  test('rejects method outside enum', () => {
    const result = expenseSchema.safeParse({
      branch: 'Kimberry',
      item: 'Cleaning',
      amount: 5,
      method: 'BTC' as unknown,
    })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// payCycleStartDaySchema (Req 10.1, 10.2, 10.4)
// ---------------------------------------------------------------------------
describe('payCycleStartDaySchema — range [1, 28]', () => {
  test.each([1, 15, 21, 28])('accepts %i', (n) => {
    expect(payCycleStartDaySchema.safeParse(n).success).toBe(true)
  })

  test.each([0, -1, 29, 31, 100])('rejects %i', (n) => {
    expect(payCycleStartDaySchema.safeParse(n).success).toBe(false)
  })

  test('rejects non-integer', () => {
    expect(payCycleStartDaySchema.safeParse(15.5).success).toBe(false)
  })

  test('rejects non-number', () => {
    expect(payCycleStartDaySchema.safeParse('15' as unknown).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// staffSchema, rosterSchema, priceSchema, commissionRateSchema — smoke tests
// ---------------------------------------------------------------------------
describe('staffSchema', () => {
  test('accepts a valid staff entry and applies defaults', () => {
    const result = staffSchema.safeParse({
      name: '  Beer  ',
      homeBranch: 'Kimberry',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Beer')
      expect(result.data.isFreelance).toBe(false)
      expect(result.data.isActive).toBe(true)
    }
  })

  test('rejects empty name post-normalisation', () => {
    const result = staffSchema.safeParse({
      name: '   ',
      homeBranch: 'Kimberry',
    })
    expect(result.success).toBe(false)
  })

  test('rejects unknown branch', () => {
    const result = staffSchema.safeParse({
      name: 'Beer',
      homeBranch: 'Penang' as unknown,
    })
    expect(result.success).toBe(false)
  })
})

describe('rosterSchema', () => {
  test('accepts a valid roster payload', () => {
    const result = rosterSchema.safeParse({
      branch: 'Bishop',
      businessDate: '2026-05-15',
      staffIds: ['id-1', 'id-2'],
    })
    expect(result.success).toBe(true)
  })

  test('accepts an empty staff list (clears the roster)', () => {
    const result = rosterSchema.safeParse({
      branch: 'Bishop',
      businessDate: '2026-05-15',
      staffIds: [],
    })
    expect(result.success).toBe(true)
  })

  test('rejects malformed businessDate', () => {
    const result = rosterSchema.safeParse({
      branch: 'Bishop',
      businessDate: '2026/5/15',
      staffIds: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('priceSchema', () => {
  test('accepts a non-negative price', () => {
    const result = priceSchema.safeParse({
      course: 'FR',
      duration: 60,
      branch: 'Kimberry',
      price: 88,
    })
    expect(result.success).toBe(true)
  })

  test('rejects a negative price', () => {
    const result = priceSchema.safeParse({
      course: 'FR',
      duration: 60,
      branch: 'Kimberry',
      price: -1,
    })
    expect(result.success).toBe(false)
  })
})

describe('commissionRateSchema', () => {
  test('accepts a regular-rate row with default branch group', () => {
    const result = commissionRateSchema.safeParse({
      course: 'FR',
      duration: 60,
      rateType: 'regular',
      amount: 18,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.branchGroup).toBe('all')
  })

  test('accepts a freelance-rate row with effectiveFrom', () => {
    const result = commissionRateSchema.safeParse({
      course: 'FR',
      duration: 60,
      rateType: 'freelance',
      amount: 25,
      effectiveFrom: '2026-01-01',
    })
    expect(result.success).toBe(true)
  })

  test('rejects unknown rateType', () => {
    const result = commissionRateSchema.safeParse({
      course: 'FR',
      duration: 60,
      rateType: 'special' as unknown,
      amount: 18,
    })
    expect(result.success).toBe(false)
  })

  test('rejects negative amount', () => {
    const result = commissionRateSchema.safeParse({
      course: 'FR',
      duration: 60,
      rateType: 'regular',
      amount: -1,
    })
    expect(result.success).toBe(false)
  })
})
