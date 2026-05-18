// salary-system-rebuild — Heals Thai Massage POS
//
// Unit tests for the pill-badge color helpers (Epic 16.1).
//
// Covers known light/dark inputs (white, black, the Tailwind palette
// hexes used by `commission.ts`, the slate-400 default), plus malformed
// input fallbacks.

import { parseHex, pickForeground } from './color'

describe('parseHex', () => {
  it('parses lowercase 6-digit hex', () => {
    expect(parseHex('#ffffff')).toEqual([255, 255, 255])
    expect(parseHex('#000000')).toEqual([0, 0, 0])
    expect(parseHex('#94a3b8')).toEqual([148, 163, 184])
  })

  it('parses uppercase 6-digit hex', () => {
    expect(parseHex('#FFFFFF')).toEqual([255, 255, 255])
    expect(parseHex('#94A3B8')).toEqual([148, 163, 184])
  })

  it('returns null for malformed input', () => {
    expect(parseHex('white')).toBeNull()
    expect(parseHex('#fff')).toBeNull()
    expect(parseHex('#94a3b')).toBeNull()
    expect(parseHex('#94a3b8x')).toBeNull()
    expect(parseHex('')).toBeNull()
    // @ts-expect-error — deliberately wrong type
    expect(parseHex(null)).toBeNull()
  })

  it('trims whitespace before parsing', () => {
    expect(parseHex('  #94a3b8 ')).toEqual([148, 163, 184])
  })
})

describe('pickForeground', () => {
  it('returns black on light backgrounds', () => {
    expect(pickForeground('#ffffff')).toBe('black') // white
    expect(pickForeground('#fbbf24')).toBe('black') // amber-400
    expect(pickForeground('#34d399')).toBe('black') // emerald-400
    expect(pickForeground('#84cc16')).toBe('black') // lime-500
    expect(pickForeground('#94a3b8')).toBe('black') // slate-400 default
  })

  it('returns white on dark backgrounds', () => {
    expect(pickForeground('#000000')).toBe('white') // black
    expect(pickForeground('#dc2626')).toBe('white') // red-600
    expect(pickForeground('#b45309')).toBe('white') // amber-700
    expect(pickForeground('#0d9488')).toBe('white') // teal-600
    expect(pickForeground('#6366f1')).toBe('white') // indigo-500
  })

  it('falls back to black when the hex is unparseable', () => {
    expect(pickForeground('not-a-hex')).toBe('black')
    expect(pickForeground('#fff')).toBe('black')
    expect(pickForeground('')).toBe('black')
  })
})
