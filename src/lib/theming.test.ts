// salary-system-rebuild — Heals Thai Massage POS
//
// Unit tests for the theming helpers. Coverage:
//   - `readableForegroundFor` returns a sensible foreground for the
//     full pill palette plus a few fixed reference points.
//   - `resolveStaffColor` is case-insensitive and falls back to the
//     slate-grey default for unknown staff.
//
// Validates: ergonomics — Epic 16, task 16.1.

import {
  COURSE_COLORS,
  DEFAULT_STAFF_COLOR,
  DURATION_COLORS,
  METHOD_COLORS,
  readableForegroundFor,
  resolveStaffColor,
} from './theming'

describe('readableForegroundFor', () => {
  it('returns near-black text for light backgrounds', () => {
    // amber-400, near-white luminance ≈ 0.7 → black text reads.
    expect(readableForegroundFor('#fbbf24')).toBe('#0f172a')
    // pure white must yield black.
    expect(readableForegroundFor('#ffffff')).toBe('#0f172a')
  })

  it('returns white text for dark backgrounds', () => {
    // teal-600 luminance ≈ 0.29 → white text reads.
    expect(readableForegroundFor('#0d9488')).toBe('#ffffff')
    // pure black must yield white.
    expect(readableForegroundFor('#000000')).toBe('#ffffff')
  })

  it('returns dark text for the slate-grey staff default (solid fill)', () => {
    // Default staff colour #94a3b8 — luminance ≈ 0.632, above the
    // 0.55 threshold so the cashier sees dark text on grey pills
    // (solid background fill).
    expect(readableForegroundFor(DEFAULT_STAFF_COLOR)).toBe('#0f172a')
  })

  it('tolerates malformed input', () => {
    // Empty / nonsense strings shouldn't throw — the helper just
    // picks a safe fallback so a stray pill still renders legibly.
    expect(readableForegroundFor('')).toBe('#0f172a')
    expect(readableForegroundFor('not a color')).toBe('#0f172a')
    expect(readableForegroundFor('#zzzzzz')).toBe('#0f172a')
  })

  it('accepts hex with or without leading hash', () => {
    expect(readableForegroundFor('14b8a6')).toBe(readableForegroundFor('#14b8a6'))
  })

  it('produces a defined foreground for every Method/Course/Duration colour', () => {
    for (const c of Object.values(METHOD_COLORS)) {
      const fg = readableForegroundFor(c)
      expect(fg === '#ffffff' || fg === '#0f172a').toBe(true)
    }
    for (const c of Object.values(COURSE_COLORS)) {
      const fg = readableForegroundFor(c)
      expect(fg === '#ffffff' || fg === '#0f172a').toBe(true)
    }
    for (const c of Object.values(DURATION_COLORS)) {
      const fg = readableForegroundFor(c)
      expect(fg === '#ffffff' || fg === '#0f172a').toBe(true)
    }
  })
})

describe('resolveStaffColor', () => {
  const colors = { lin: '#ff0000', beer: '#00ff00' }

  it('returns the owner-picked colour for a known staff (case-insensitive)', () => {
    expect(resolveStaffColor('Lin', colors)).toBe('#ff0000')
    expect(resolveStaffColor('lin', colors)).toBe('#ff0000')
    expect(resolveStaffColor('LIN', colors)).toBe('#ff0000')
  })

  it('trims whitespace before lookup', () => {
    expect(resolveStaffColor('  Beer  ', colors)).toBe('#00ff00')
  })

  it('falls back to DEFAULT_STAFF_COLOR for unknown staff', () => {
    expect(resolveStaffColor('Tina', colors)).toBe(DEFAULT_STAFF_COLOR)
    expect(resolveStaffColor('', colors)).toBe(DEFAULT_STAFF_COLOR)
  })

  it('falls back when the colour map is empty', () => {
    expect(resolveStaffColor('Lin', {})).toBe(DEFAULT_STAFF_COLOR)
  })
})
