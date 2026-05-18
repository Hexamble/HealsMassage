/**
 * Unit tests for `extra.ts`.
 *
 * Coverage per task 2.5 (heals-system-rebuild):
 *   - All `decodeExtraDestination` prefixes in mixed case
 *     (KM/KIM → Kimberry, BS/BIS → Bishop, CL/CH/CHU → Chulia)
 *   - Invalid inputs to `decodeExtraDestination` (non-EXTRA, undecodable
 *     suffix, empty/garbage)
 *   - `buildExtraMatchKey` normalisation under case, whitespace, and
 *     duration-string-vs-number; discrimination across each logical field
 *   - `isExtraMethod` true/false cases (whitespace tolerance, EXTRA must
 *     appear as a whole word)
 *
 * Validates: Requirements 5.1, 5.4, 5.5
 */

import {
  decodeExtraDestination,
  buildExtraMatchKey,
  isExtraMethod,
} from './extra'
import type { Branch } from './types'

// ---------------------------------------------------------------------------
// isExtraMethod
// ---------------------------------------------------------------------------

describe('isExtraMethod', () => {
  it.each([
    ['EXTRA'],
    ['EXTRA KM'],
    ['EXTRA KIM'],
    ['EXTRA BS'],
    ['EXTRA BIS'],
    ['EXTRA CL'],
    ['EXTRA CH'],
    ['EXTRA CHU'],
    ['extra-bs'],
    ['extra_km'],
    ['EXTRA  CL'],
    ['  extra cl  '],
    ['ExTrA Bs'],
  ])('returns true for %p', (input) => {
    expect(isExtraMethod(input)).toBe(true)
  })

  it.each([
    ['CASH'],
    ['QR'],
    ['CREDIT'],
    ['Freelance'],
    ['EXTRACT'], // letter boundary — EXTRA must be a whole word
    ['EXTRA1'], // digit boundary — same rule
    ['EXTRAKM'], // no separator after EXTRA
    [''],
    ['   '],
    ['KM'],
  ])('returns false for %p', (input) => {
    expect(isExtraMethod(input)).toBe(false)
  })

  it('returns false for non-string inputs', () => {
    expect(isExtraMethod(undefined as unknown as string)).toBe(false)
    expect(isExtraMethod(null as unknown as string)).toBe(false)
    expect(isExtraMethod(42 as unknown as string)).toBe(false)
    expect(isExtraMethod({} as unknown as string)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// decodeExtraDestination — every recognised prefix in mixed case
// ---------------------------------------------------------------------------

describe('decodeExtraDestination', () => {
  it.each<[string, Branch]>([
    // Kimberry: KM and KIM
    ['EXTRA KM', 'Kimberry'],
    ['extra km', 'Kimberry'],
    ['ExTrA Km', 'Kimberry'],
    ['EXTRA-KM', 'Kimberry'],
    ['EXTRA_KM', 'Kimberry'],
    ['EXTRA KIM', 'Kimberry'],
    ['extra kim', 'Kimberry'],
    ['EXTRA  KIM ', 'Kimberry'],
    // Bishop: BS and BIS
    ['EXTRA BS', 'Bishop'],
    ['extra bs', 'Bishop'],
    ['EXTRA-BS', 'Bishop'],
    ['EXTRA BIS', 'Bishop'],
    ['extra bis', 'Bishop'],
    ['ExTrA BiS', 'Bishop'],
    // Chulia: CL, CH, CHU
    ['EXTRA CL', 'Chulia'],
    ['extra cl', 'Chulia'],
    ['EXTRA-CL', 'Chulia'],
    ['EXTRA CH', 'Chulia'],
    ['extra ch', 'Chulia'],
    ['EXTRA CHU', 'Chulia'],
    ['extra chu', 'Chulia'],
    ['  ExTrA  ChU  ', 'Chulia'],
  ])('decodes %p → %p', (input, expected) => {
    expect(decodeExtraDestination(input)).toBe(expected)
  })

  it.each([
    ['EXTRA'], // no suffix
    ['EXTRA QQ'], // unknown suffix
    ['EXTRA XX'],
    ['EXTRA 123'],
    ['CASH'], // not an EXTRA marker
    ['QR'],
    ['Freelance'],
    [''], // empty
    ['EXTRACT'], // letter boundary — not a whole word
    ['EXTRAKM'], // no separator, fails isExtraMethod
  ])('returns null for %p', (input) => {
    expect(decodeExtraDestination(input)).toBeNull()
  })

  it('returns null for non-string inputs', () => {
    expect(decodeExtraDestination(undefined as unknown as string)).toBeNull()
    expect(decodeExtraDestination(null as unknown as string)).toBeNull()
    expect(decodeExtraDestination(42 as unknown as string)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// buildExtraMatchKey — normalisation invariance
// ---------------------------------------------------------------------------

describe('buildExtraMatchKey — normalisation', () => {
  it('is invariant under case differences in staff and course', () => {
    const a = buildExtraMatchKey({
      staff: 'Beer',
      businessDate: '2026-05-15',
      course: 'fr',
      duration: 60,
      branch: 'Kimberry',
    })
    const b = buildExtraMatchKey({
      staff: 'BEER',
      businessDate: '2026-05-15',
      course: 'FR',
      duration: 60,
      branch: 'Kimberry',
    })
    expect(a).toBe(b)
  })

  it('is invariant under surrounding whitespace on staff and course', () => {
    const a = buildExtraMatchKey({
      staff: 'Beer',
      businessDate: '2026-05-15',
      course: 'FR',
      duration: 60,
      branch: 'Kimberry',
    })
    const b = buildExtraMatchKey({
      staff: '  Beer  ',
      businessDate: '2026-05-15',
      course: '  FR  ',
      duration: 60,
      branch: 'Kimberry',
    })
    expect(a).toBe(b)
  })

  it('is invariant under string-vs-number duration', () => {
    const a = buildExtraMatchKey({
      staff: 'Beer',
      businessDate: '2026-05-15',
      course: 'FR',
      duration: 60,
      branch: 'Kimberry',
    })
    const b = buildExtraMatchKey({
      staff: 'Beer',
      businessDate: '2026-05-15',
      course: 'FR',
      duration: '60',
      branch: 'Kimberry',
    })
    expect(a).toBe(b)
  })

  it('produces lowercase staff, uppercase course, integer duration', () => {
    const key = buildExtraMatchKey({
      staff: '  BEER  ',
      businessDate: '2026-05-15',
      course: 'fr',
      duration: '60',
      branch: 'Kimberry',
    })
    expect(key).toBe('beer|2026-05-15|FR|60|Kimberry')
  })
})

// ---------------------------------------------------------------------------
// buildExtraMatchKey — discrimination
// ---------------------------------------------------------------------------

describe('buildExtraMatchKey — discrimination', () => {
  const base = {
    staff: 'Beer',
    businessDate: '2026-05-15',
    course: 'FR' as const,
    duration: 60,
    branch: 'Kimberry' as Branch,
  }

  it('different staff → different key', () => {
    expect(buildExtraMatchKey(base)).not.toBe(
      buildExtraMatchKey({ ...base, staff: 'Ney' }),
    )
  })

  it('different businessDate → different key', () => {
    expect(buildExtraMatchKey(base)).not.toBe(
      buildExtraMatchKey({ ...base, businessDate: '2026-05-16' }),
    )
  })

  it('different course → different key', () => {
    expect(buildExtraMatchKey(base)).not.toBe(
      buildExtraMatchKey({ ...base, course: 'HS' }),
    )
  })

  it('different duration → different key', () => {
    expect(buildExtraMatchKey(base)).not.toBe(
      buildExtraMatchKey({ ...base, duration: 90 }),
    )
  })

  it('different branch → different key', () => {
    expect(buildExtraMatchKey(base)).not.toBe(
      buildExtraMatchKey({ ...base, branch: 'Chulia' }),
    )
  })
})
