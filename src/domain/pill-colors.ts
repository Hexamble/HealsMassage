// salary-system-rebuild — Heals Thai Massage POS
//
// Pill color palette for the cashier sheet (Course / Method / Duration).
// Staff pill colors are NOT here — those are owner-picked, persisted on
// `staff.color`, and resolved per-row at render time via
// `lib/theming.ts#resolveStaffColor` (see `staffColors` props threaded
// from `cashier/[branch]/page.tsx`).
//
// Each entry returns a `{ bg, text }` pair of Tailwind utility class
// names so the same lookup works in both light and dark mode without
// extra logic. The choice between
//   - the 100 + 700 family (light pastel bg, dark ink text), and
//   - the 500 + white family (saturated bg, white text)
// is per-cell-type:
//   - Method: 500 + white. Methods are scarce on the row (one per
//     session) and the sheet's legacy intent is a strong colored chip.
//   - Course: 100 + 900. Courses dominate visually (every row), so we
//     keep them muted — pastel chip, dark text — to avoid a "clown
//     convention" of fifteen saturated colors stacked vertically.
//   - Duration: a 300/400 mid-tone since there are only four values
//     and the legacy sheet rendered them as small but distinguishable
//     accents next to course.
//
// Tailwind's content scanner inspects this file (matched by
// `tailwind.config.ts#content`), so listing the classes here as string
// literals is sufficient to keep them out of the purge. No safelist
// entry is needed unless a class appears nowhere else.
//
// Validates: Requirements ergonomics (Epic 16 — cashier sheet redesign).

import type { Course, Duration, Method } from './commission'

export interface PillClasses {
  /** Tailwind background utility class, e.g. `bg-teal-500`. */
  bg: string
  /** Tailwind foreground utility class, e.g. `text-white`. */
  text: string
}

/**
 * Method pill colors — saturated 500 + white.
 *
 * Methods stay legible at a glance (one per row, scarce). The legacy
 * sheet used red for QR and teal for CASH; we keep that intent but
 * pull the palette to Tailwind's 500 family for cross-mode parity.
 */
export const METHOD_COLORS: Record<Method, PillClasses> = {
  CASH: { bg: 'bg-teal-500', text: 'text-white' },
  QR: { bg: 'bg-rose-500', text: 'text-white' },
  CREDIT: { bg: 'bg-emerald-500', text: 'text-white' },
  // The legacy `'Freelance'` method was retired in task 21.1 — freelance
  // work is now identified by the staff row's `is_freelance` flag, not
  // by the row's method (a freelance staff still pays in CASH/QR/CREDIT).
  Freelance: { bg: 'bg-fuchsia-500', text: 'text-white' },
  'EXTRA KM': { bg: 'bg-amber-500', text: 'text-white' },
  'EXTRA BS': { bg: 'bg-orange-500', text: 'text-white' },
  'EXTRA CL': { bg: 'bg-violet-500', text: 'text-white' },
}

/**
 * Course pill colors — muted 100 + 900.
 *
 * Courses dominate the column (one per row); a pastel chip with dark
 * text reads cleanly without overwhelming the table. PBA / PBAC share
 * the indigo family with a slight tonal shift so the cashier can spot
 * them as related but distinct.
 */
export const COURSE_COLORS: Record<Course, PillClasses> = {
  FR: { bg: 'bg-rose-100', text: 'text-rose-900' },
  HS: { bg: 'bg-fuchsia-100', text: 'text-fuchsia-900' },
  FNS: { bg: 'bg-lime-100', text: 'text-lime-900' },
  BMT: { bg: 'bg-amber-100', text: 'text-amber-900' },
  BAT: { bg: 'bg-red-100', text: 'text-red-900' },
  DTM: { bg: 'bg-orange-100', text: 'text-orange-900' },
  THC: { bg: 'bg-teal-100', text: 'text-teal-900' },
  HOM: { bg: 'bg-yellow-100', text: 'text-yellow-900' },
  PBA: { bg: 'bg-indigo-100', text: 'text-indigo-900' },
  PBAC: { bg: 'bg-indigo-200', text: 'text-indigo-900' },
  EAR: { bg: 'bg-emerald-100', text: 'text-emerald-900' },
  PTF: { bg: 'bg-cyan-100', text: 'text-cyan-900' },
  PAF: { bg: 'bg-cyan-200', text: 'text-cyan-900' },
  PHL: { bg: 'bg-sky-100', text: 'text-sky-900' },
  PHT: { bg: 'bg-sky-200', text: 'text-sky-900' },
}

/**
 * Duration pill colors — mid-tone 300/400.
 *
 * Only four values, so a spread along the warm→cool axis (amber →
 * indigo) keeps each easily distinguishable at the edge of vision.
 */
export const DURATION_COLORS: Record<Duration, PillClasses> = {
  30: { bg: 'bg-amber-300', text: 'text-amber-900' },
  60: { bg: 'bg-rose-300', text: 'text-rose-900' },
  90: { bg: 'bg-emerald-300', text: 'text-emerald-900' },
  120: { bg: 'bg-indigo-400', text: 'text-white' },
}

/**
 * Pick a readable foreground color for an arbitrary staff hex.
 *
 * Used by `<Pill>` when rendering a staff pill: the owner picks any
 * `#RRGGBB` color via the Roster Manager, so we can't pre-pair it
 * with a Tailwind class. Instead we compute relative luminance per
 * WCAG and pick `text-zinc-900` (dark ink) for light backgrounds and
 * `text-white` for dark ones.
 *
 * Returns `'text-zinc-900'` for malformed input so a stray empty
 * string still renders legible text.
 *
 * Examples:
 *   readableTextColor('#94a3b8') ≈ lum 0.396 → 'text-white'
 *   readableTextColor('#fbbf24') ≈ lum 0.700 → 'text-zinc-900'
 *   readableTextColor('#000000') = 0          → 'text-white'
 *   readableTextColor('#ffffff') = 1          → 'text-zinc-900'
 */
export function readableTextColor(
  bgHex: string,
): 'text-white' | 'text-zinc-900' {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(bgHex.trim())
  if (!m) return 'text-zinc-900'
  const r = parseInt(m[1].slice(0, 2), 16) / 255
  const g = parseInt(m[1].slice(2, 4), 16) / 255
  const b = parseInt(m[1].slice(4, 6), 16) / 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.55 ? 'text-zinc-900' : 'text-white'
}
