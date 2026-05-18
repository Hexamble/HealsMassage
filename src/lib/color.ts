// salary-system-rebuild — Heals Thai Massage POS
//
// Tiny color utilities for the cashier pill badges (Epic 16.1).
//
// `pickForeground(hex)` returns 'white' or 'black' depending on which
// gives better contrast against the supplied background. We use the YIQ
// brightness formula (luma approximation) — fast, dependency-free, and
// well-correlated with perceptual contrast for the small set of colors
// we actually display on a pill (Tailwind 400/500 shades + an
// owner-picked staff color). For anything more nuanced we'd reach for
// WCAG relative-luminance, but YIQ is sufficient for "is this
// background dark enough that white text reads better?".
//
// The threshold 128 is the standard YIQ midpoint. Background hexes that
// score ≥ 128 are "light" (use black text); those below are "dark"
// (use white text).
//
// Validates: Requirements ergonomics (Epic 16 — cashier sheet redesign).

/**
 * Parse a `#rrggbb` (or `#RRGGBB`) hex string into a `[r, g, b]` tuple
 * of integers in `[0, 255]`. Returns `null` for malformed input so
 * callers can fall back to a sensible default.
 *
 * The regex matches exactly the shape that the DB CHECK constraint and
 * `staffInputSchema.color` regex accept, so this never sees junk in
 * production — but defensive parsing keeps the function safe to call
 * from the UI before the data has been validated.
 */
export function parseHex(hex: string): [number, number, number] | null {
  if (typeof hex !== 'string') return null
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/**
 * Pick `'white'` or `'black'` foreground for a background hex.
 *
 * Uses the YIQ brightness formula:
 *   yiq = (r * 299 + g * 587 + b * 114) / 1000
 *
 * Returns:
 *   - `'black'` when the background is light (yiq ≥ 128)
 *   - `'white'` when the background is dark (yiq < 128)
 *   - `'black'` as a safe default when the hex is unparseable
 *     (matches Tailwind's neutral grey default `#94a3b8`, which is light)
 */
export function pickForeground(hex: string): 'white' | 'black' {
  const rgb = parseHex(hex)
  if (!rgb) return 'black'
  const [r, g, b] = rgb
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 128 ? 'black' : 'white'
}
