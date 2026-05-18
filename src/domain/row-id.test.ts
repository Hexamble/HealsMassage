/**
 * Unit tests for `row-id.ts`.
 *
 * Validates: Requirements 3.1 (row_id format) and 3.5 (uniqueness key).
 *
 * See `c:/BILL/.kiro/specs/heals-system-rebuild/tasks.md` task 2.3 and
 *     `c:/BILL/.kiro/specs/heals-system-rebuild/design.md`
 *     §"Domain Layer Components" → `row-id.ts`.
 */

import { buildRowId, parseRowId } from './row-id'
import type { Branch } from './types'

// ---------------------------------------------------------------------------
// buildRowId — formatting
// ---------------------------------------------------------------------------

describe('buildRowId', () => {
  it('formats Kimberry rows as "{branch}|{businessDate}|{cashierRowNumber}"', () => {
    expect(buildRowId('Kimberry', '2026-05-15', 3)).toBe('Kimberry|2026-05-15|3')
  })

  it('formats Bishop rows as "{branch}|{businessDate}|{cashierRowNumber}"', () => {
    expect(buildRowId('Bishop', '2026-04-21', 1)).toBe('Bishop|2026-04-21|1')
  })

  it('formats Chulia rows with large cashier row numbers', () => {
    expect(buildRowId('Chulia', '2026-12-20', 999)).toBe('Chulia|2026-12-20|999')
  })

  it('emits zero as a single "0" digit', () => {
    expect(buildRowId('Kimberry', '2026-01-01', 0)).toBe('Kimberry|2026-01-01|0')
  })
})

// ---------------------------------------------------------------------------
// parseRowId — happy path
// ---------------------------------------------------------------------------

describe('parseRowId — happy path', () => {
  it('round-trips a canonical row_id back to its parts', () => {
    expect(parseRowId('Kimberry|2026-05-15|3')).toEqual({
      branch: 'Kimberry',
      businessDate: '2026-05-15',
      cashierRowNumber: 3,
    })
  })

  it('parses each branch correctly', () => {
    expect(parseRowId('Bishop|2026-04-21|1').branch).toBe('Bishop')
    expect(parseRowId('Chulia|2026-12-20|42').branch).toBe('Chulia')
  })

  it('parses zero as a valid cashier row number', () => {
    expect(parseRowId('Bishop|2026-04-21|0').cashierRowNumber).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// parseRowId — malformed input throws
// ---------------------------------------------------------------------------

describe('parseRowId — malformed input throws', () => {
  it('throws on an unknown branch', () => {
    expect(() => parseRowId('Foo|2026-04-21|1')).toThrow(/branch/i)
  })

  it('throws on an empty branch segment', () => {
    expect(() => parseRowId('|2026-04-21|1')).toThrow(/branch/i)
  })

  it('throws on a business_date that does not match yyyy-MM-dd', () => {
    expect(() => parseRowId('Kimberry|not-a-date|1')).toThrow(/business_date/i)
  })

  it('throws on a non-numeric cashier row number', () => {
    expect(() => parseRowId('Kimberry|2026-05-15|abc')).toThrow(
      /cashier_row_number/i,
    )
  })

  it('throws on a leading-zero cashier row number', () => {
    // String(parseInt('003', 10)) === '3' !== '003' — must be rejected so
    // the canonical form is the only acceptable representation.
    expect(() => parseRowId('Kimberry|2026-05-15|003')).toThrow(
      /cashier_row_number/i,
    )
  })

  it('throws on a negative cashier row number', () => {
    expect(() => parseRowId('Kimberry|2026-05-15|-1')).toThrow(
      /cashier_row_number/i,
    )
  })

  it('throws on a fractional cashier row number', () => {
    expect(() => parseRowId('Kimberry|2026-05-15|3.14')).toThrow(
      /cashier_row_number/i,
    )
  })

  it('throws on input with no pipe separators', () => {
    expect(() => parseRowId('garbage')).toThrow(/3 pipe-separated parts/i)
  })

  it('throws on input with only two pipe-delimited parts (missing pipe)', () => {
    expect(() => parseRowId('Kimberry|2026-05-15')).toThrow(
      /3 pipe-separated parts/i,
    )
  })

  it('throws on input with four pipe-delimited parts', () => {
    expect(() => parseRowId('Kimberry|2026-05-15|1|extra')).toThrow(
      /3 pipe-separated parts/i,
    )
  })

  it('throws on the empty string', () => {
    expect(() => parseRowId('')).toThrow(/3 pipe-separated parts/i)
  })
})

// ---------------------------------------------------------------------------
// Round-trip — build then parse
// ---------------------------------------------------------------------------

describe('build/parse round-trip', () => {
  const cases: ReadonlyArray<readonly [Branch, string, number]> = [
    ['Kimberry', '2026-05-15', 1],
    ['Bishop', '2026-04-21', 42],
    ['Chulia', '2026-12-31', 9999],
    ['Kimberry', '2025-01-01', 0],
    ['Bishop', '2030-06-15', 100_001],
  ]

  it.each(cases)(
    'parseRowId(buildRowId(%s, %s, %i)) returns the same parts',
    (branch, businessDate, cashierRowNumber) => {
      const built = buildRowId(branch, businessDate, cashierRowNumber)
      expect(parseRowId(built)).toEqual({
        branch,
        businessDate,
        cashierRowNumber,
      })
    },
  )
})
